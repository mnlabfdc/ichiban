import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taipeiDate } from "../src/shared/time";
import { Client, clientId, createUser, resetDb, startDb, type TestContext } from "./helpers";

let ctx: TestContext;
let owner: Client;

beforeAll(async () => {
  ctx = await startDb();
});

afterAll(async () => {
  await ctx?.dispose();
});

beforeEach(async () => {
  await resetDb(ctx.env.DB);
  owner = await new Client(ctx.env).login();
});

function staff(username = "clerk") {
  return createUser(owner, ctx.env, { username, role: "staff", displayName: `店員${username}` });
}

async function openSet(as: Client, overrides: Record<string, unknown> = {}) {
  const res = await as.post("/sets", {
    barcode: "4710000000001",
    name: "測試賞",
    branchId: 1,
    cost: 1000,
    pricePerDraw: 100,
    totalDraws: 20,
    ...overrides,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

function scan(as: Client, body: Record<string, unknown>) {
  return as.post("/counter/scan", { clientId: clientId(), branchId: 1, ...body });
}

/** 工作人員拿到的任何資料都不能有成本、已收金額、回本線、期初 */
function expectNoCostInfo(body: unknown) {
  const text = JSON.stringify(body);
  for (const key of ["cost", "revenue", "breakeven", "opening"]) {
    expect(text, `回應裡不該有 ${key}`).not.toMatch(new RegExp(`"${key}`, "i"));
  }
}

describe("帳號", () => {
  it("店主用 Worker secret 的帳密登入，固定是管理員", async () => {
    const me = (await owner.get("/me")).body.user;
    expect(me).toMatchObject({ id: "owner", role: "admin", isOwner: true, displayName: "店主" });
  });

  it("管理員建立的工作人員可以登入，帳號不分大小寫", async () => {
    await staff("clerk");
    const again = await new Client(ctx.env).login("CLERK", "staff-password-1");
    expect((await again.get("/me")).body.user).toMatchObject({ username: "clerk", role: "staff", isOwner: false });
  });

  it("帳號重複、跟店主同名、格式不對、密碼太短都不能建立", async () => {
    await staff("clerk");
    const base = { displayName: "x", role: "staff", password: "long-enough" };
    expect((await owner.post("/users", { ...base, username: "Clerk" })).body.code).toBe("username_taken");
    expect((await owner.post("/users", { ...base, username: "admin" })).body.code).toBe("username_taken");
    expect((await owner.post("/users", { ...base, username: "店員" })).status).toBe(400);
    expect((await owner.post("/users", { ...base, username: "ok-name", password: "short" })).status).toBe(400);
  });

  it("連續輸錯 10 次就鎖住，鎖住時密碼對也進不去", async () => {
    await staff("clerk");
    const guest = new Client(ctx.env);
    for (let i = 0; i < 10; i++) {
      expect((await guest.post("/login", { username: "clerk", password: "wrong" })).status).toBe(401);
    }
    const locked = await guest.post("/login", { username: "clerk", password: "staff-password-1" });
    expect(locked.status).toBe(429);
    // 時間過了就解鎖
    await ctx.env.DB.prepare("UPDATE login_attempts SET locked_until = ?")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    expect((await guest.post("/login", { username: "clerk", password: "staff-password-1" })).status).toBe(200);
  });

  it("停用後那個人的電腦全部登出、也不能再登入；恢復後可以", async () => {
    const { client, id } = await staff("clerk");
    expect((await owner.patch(`/users/${id}`, { disabled: true })).body.disabled).toBe(true);
    expect((await client.get("/me")).status).toBe(401);
    const retry = await new Client(ctx.env).post("/login", { username: "clerk", password: "staff-password-1" });
    expect(retry.body.code).toBe("disabled");
    await owner.patch(`/users/${id}`, { disabled: false });
    await new Client(ctx.env).login("clerk", "staff-password-1");
  });

  it("重設密碼後舊的登入失效、舊密碼不能用", async () => {
    const { client, id } = await staff("clerk");
    await owner.post(`/users/${id}/password`, { password: "brand-new-pass" });
    expect((await client.get("/me")).status).toBe(401);
    const old = await new Client(ctx.env).post("/login", { username: "clerk", password: "staff-password-1" });
    expect(old.status).toBe(401);
    await new Client(ctx.env).login("clerk", "brand-new-pass");
  });

  it("改自己的密碼：要對目前密碼，改完其他電腦登出、這台不用", async () => {
    const { client } = await staff("clerk");
    const other = await new Client(ctx.env).login("clerk", "staff-password-1");
    const wrong = await client.post("/me/password", { currentPassword: "nope", newPassword: "another-pass" });
    expect(wrong.body.code).toBe("bad_password");
    const ok = await client.post("/me/password", { currentPassword: "staff-password-1", newPassword: "another-pass" });
    expect(ok.status).toBe(200);
    expect((await client.get("/me")).status).toBe(200);
    expect((await other.get("/me")).status).toBe(401);
  });

  it("店主帳號不能在系統裡修改", async () => {
    expect((await owner.patch("/users/owner", { role: "staff" })).status).toBe(403);
    expect((await owner.post("/users/owner/password", { password: "whatever-123" })).status).toBe(403);
    expect((await owner.post("/me/password", { currentPassword: "test-password", newPassword: "x-12345678" })).status).toBe(400);
  });

  it("不能停用自己或改自己的角色", async () => {
    const { client, id } = await createUser(owner, ctx.env, { username: "boss2", role: "admin" });
    expect((await client.patch(`/users/${id}`, { disabled: true })).status).toBe(400);
    expect((await client.patch(`/users/${id}`, { role: "staff" })).status).toBe(400);
    expect((await client.patch(`/users/${id}`, { displayName: "副店長" })).body.displayName).toBe("副店長");
  });

  it("角色改變立刻生效", async () => {
    const { client, id } = await staff("clerk");
    expect((await client.get("/reports?from=2026-01-01&to=2026-01-01")).status).toBe(403);
    await owner.patch(`/users/${id}`, { role: "admin" });
    expect((await client.get("/reports?from=2026-01-01&to=2026-01-01")).status).toBe(200);
  });
});

describe("工作人員權限", () => {
  it("管理員限定的功能都回 403", async () => {
    const set = await openSet(owner);
    const sale = (await scan(owner, { barcode: "4710000000001" })).body.sale;
    const { client } = await staff();
    const calls: [string, string, unknown?][] = [
      ["GET", "/sets"],
      ["GET", `/sets/${set.id}`],
      ["PATCH", `/sets/${set.id}`, { name: "x" }],
      ["POST", `/sets/${set.id}/transfer`, { branchId: 2 }],
      ["DELETE", `/sets/${set.id}`],
      ["POST", "/sales", { clientId: clientId(), setId: set.id, quantity: 1, amount: 1, soldAt: new Date().toISOString() }],
      ["PATCH", `/sales/${sale.id}`, { amount: 1 }],
      ["POST", `/sales/${sale.id}/revoke`, {}],
      ["GET", "/completed"],
      ["GET", "/reports?from=2026-01-01&to=2026-01-01"],
      ["GET", `/audit?entity=sale&entityId=${sale.id}`],
      ["GET", "/users"],
      ["POST", "/users", { username: "sneaky", displayName: "x", role: "admin", password: "password-123" }],
      ["POST", "/logout-all", {}],
    ];
    for (const [method, path, body] of calls) {
      const res = await client.req(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("看板和櫃檯給工作人員的資料都沒有成本相關欄位", async () => {
    await openSet(owner, { name: "A 款", openingDraws: 2, openingRevenue: 200 });
    await openSet(owner, { name: "B 款" });
    const { client } = await staff();

    const dash = await client.get("/dashboard");
    expect(dash.body.sets).toHaveLength(2);
    expectNoCostInfo(dash.body);

    const choose = await scan(client, { barcode: "4710000000001" });
    expect(choose.body.status).toBe("choose");
    expectNoCostInfo(choose.body);

    const recorded = await scan(client, { setId: choose.body.candidates[0].id });
    expect(recorded.body.status).toBe("recorded");
    expectNoCostInfo(recorded.body);

    expectNoCostInfo((await client.get("/counter/sets?branchId=1")).body);
    expectNoCostInfo((await client.get("/counter/last?branchId=1")).body);
    expectNoCostInfo(
      (await client.post("/counter/change-amount", { saleId: recorded.body.sale.id, branchId: 1, amount: 80 })).body,
    );
    expectNoCostInfo((await client.post("/counter/revoke-last", { branchId: 1 })).body);
    expectNoCostInfo((await client.get("/sets/prefill?barcode=4710000000001")).body);
  });

  it("管理員看板有成本資料", async () => {
    await openSet(owner);
    const dash = await owner.get("/dashboard");
    expect(dash.body.sets[0]).toMatchObject({ cost: 1000, revenue: 0 });
  });

  it("工作人員開套：同條碼沿用最近一套的成本，新款成本待補；送來的成本和期初都不採用", async () => {
    await openSet(owner, { cost: 777 });
    const { client } = await staff();
    const restock = await client.post("/sets", {
      barcode: "4710000000001",
      name: "補貨",
      branchId: 1,
      pricePerDraw: 100,
      totalDraws: 20,
      cost: 1,
      openingDraws: 5,
      openingRevenue: 500,
    });
    expect(restock.status).toBe(201);
    expectNoCostInfo(restock.body);
    const full = (await owner.get(`/sets/${restock.body.id}`)).body;
    expect(full).toMatchObject({ cost: 777, openingDraws: 0, openingRevenue: 0, soldDraws: 0 });

    const fresh = await client.post("/sets", {
      barcode: "new-item",
      name: "新款",
      branchId: 1,
      pricePerDraw: 150,
      totalDraws: 10,
    });
    expect((await owner.get(`/sets/${fresh.body.id}`)).body.cost).toBeNull();
  });

  it("今天的銷售：工作人員要指定分店，而且只看得到今天的", async () => {
    const set = await openSet(owner);
    await scan(owner, { barcode: "4710000000001" });
    await owner.post("/sales", {
      clientId: clientId(),
      setId: set.id,
      quantity: 1,
      amount: 100,
      soldAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    const { client } = await staff();
    expect((await client.get("/sales")).status).toBe(400);
    const list = await client.get("/sales?branchId=1&from=2020-01-01&to=2030-12-31");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].type).toBe("normal");
    expect(taipeiDate(list.body[0].soldAt)).toBe(taipeiDate());
    // 管理員照指定的日期查
    expect((await owner.get("/sales?branchId=1&from=2020-01-01&to=2030-12-31")).body).toHaveLength(2);
  });

  it("櫃檯改金額只能改本分店今天櫃檯刷的", async () => {
    const set = await openSet(owner);
    const { client } = await staff();
    const mine = (await scan(client, { barcode: "4710000000001" })).body.sale;
    expect((await client.post("/counter/change-amount", { saleId: mine.id, branchId: 1, amount: 90 })).body.sale.amount).toBe(90);
    // 別家分店
    expect((await client.post("/counter/change-amount", { saleId: mine.id, branchId: 2, amount: 80 })).body.code).toBe(
      "not_changeable",
    );
    // 補登的
    const backfill = (
      await owner.post("/sales", { clientId: clientId(), setId: set.id, quantity: 1, amount: 100, soldAt: new Date().toISOString() })
    ).body.sale;
    expect((await client.post("/counter/change-amount", { saleId: backfill.id, branchId: 1, amount: 1 })).body.code).toBe(
      "not_changeable",
    );
  });

  it("銷售和修改紀錄記下是誰做的", async () => {
    await openSet(owner);
    const { client } = await staff("amy");
    const sale = (await scan(client, { barcode: "4710000000001" })).body.sale;
    expect(sale.createdByName).toBe("店員amy");
    await client.post("/counter/change-amount", { saleId: sale.id, branchId: 1, amount: 50 });
    await owner.post(`/sales/${sale.id}/revoke`);
    const audit = (await owner.get(`/audit?entity=sale&entityId=${sale.id}`)).body;
    expect(audit.map((a: { action: string; userName: string }) => [a.action, a.userName])).toEqual([
      ["create", "店員amy"],
      ["update", "店員amy"],
      ["revoke", "店主"],
    ]);
  });
});

describe("待補成本", () => {
  it("成本待補時沒有回本線；管理員補上成本後重算", async () => {
    const { client } = await staff();
    const created = await client.post("/sets", {
      barcode: "new-item",
      name: "新款",
      branchId: 1,
      pricePerDraw: 100,
      totalDraws: 10,
    });
    await scan(client, { barcode: "new-item", quantity: 6 });
    const pending = (await owner.get(`/sets/${created.body.id}`)).body;
    expect(pending).toMatchObject({ cost: null, revenue: 600, breakevenDraws: null });
    const filled = await owner.patch(`/sets/${created.body.id}`, { cost: 500 });
    expect(filled.body).toMatchObject({ cost: 500, breakevenDraws: 5 });
  });
});
