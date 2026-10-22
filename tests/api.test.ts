import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taipeiDate } from "../src/shared/time";
import type { SetDto } from "../src/shared/types";
import { Client, clientId, resetDb, startDb, type TestContext } from "./helpers";

let ctx: TestContext;
let api: Client;

beforeAll(async () => {
  ctx = await startDb();
});

afterAll(async () => {
  await ctx?.dispose();
});

beforeEach(async () => {
  await resetDb(ctx.env.DB);
  api = await new Client(ctx.env).login();
});

async function openSet(overrides: Record<string, unknown> = {}): Promise<SetDto> {
  const res = await api.post("/sets", {
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

function scan(body: Record<string, unknown>) {
  return api.post("/counter/scan", { clientId: clientId(), branchId: 1, ...body });
}

async function version(): Promise<number> {
  return (await api.get("/version")).body.version;
}

describe("登入", () => {
  it("沒登入不能用 API", async () => {
    const anon = new Client(ctx.env);
    expect((await anon.get("/dashboard")).status).toBe(401);
  });

  it("密碼錯誤不能登入", async () => {
    const res = await new Client(ctx.env).post("/login", { username: "admin", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("登出後這台的 cookie 失效", async () => {
    const stale = api.cookie;
    await api.post("/logout");
    const reused = new Client(ctx.env);
    reused.cookie = stale;
    expect((await reused.get("/me")).status).toBe(401);
  });

  it("登出所有電腦會讓每台都失效", async () => {
    const other = await new Client(ctx.env).login();
    expect((await other.get("/me")).status).toBe(200);
    await api.post("/logout-all");
    expect((await other.get("/me")).status).toBe(401);
  });
});

describe("櫃檯刷條碼", () => {
  it("刷一次記 1 抽，金額用目前每抽價格", async () => {
    await openSet();
    const res = await scan({ barcode: "4710000000001" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("recorded");
    expect(res.body.sale).toMatchObject({ quantity: 1, amount: 100, type: "normal", createdByName: "店主" });
    expect(res.body.set).toMatchObject({ soldDraws: 1 });
    expect((await api.get(`/sets/${res.body.set.id}`)).body.revenue).toBe(100);
  });

  it("先輸入數量可以一次記多抽", async () => {
    await openSet();
    const res = await scan({ barcode: "4710000000001", quantity: 3 });
    expect(res.body.sale).toMatchObject({ quantity: 3, amount: 300 });
  });

  it("同一個 clientId 重送只記一次", async () => {
    await openSet();
    const id = clientId();
    await api.post("/counter/scan", { clientId: id, branchId: 1, barcode: "4710000000001" });
    const again = await api.post("/counter/scan", { clientId: id, branchId: 1, barcode: "4710000000001" });
    expect(again.body.duplicate).toBe(true);
    expect(again.body.set.soldDraws).toBe(1);
    const found = await api.get(`/counter/sale-by-client/${id}`);
    expect(found.body.sale.clientId).toBe(id);
    expect((await api.get(`/counter/sale-by-client/never-sent`)).body.sale).toBeNull();
  });

  it("找不到條碼、或套在別家分店時不記帳", async () => {
    await openSet({ branchId: 2 });
    expect((await scan({ barcode: "4710000000001" })).body.code).toBe("not_found");
    expect((await scan({ barcode: "nope" })).status).toBe(404);
  });

  it("同條碼對到多套時回傳選單，選好再記", async () => {
    const a = await openSet({ name: "A 款" });
    await openSet({ name: "B 款" });
    const res = await scan({ barcode: "4710000000001" });
    expect(res.body.status).toBe("choose");
    expect(res.body.candidates).toHaveLength(2);
    const chosen = await scan({ setId: a.id });
    expect(chosen.body.set.name).toBe("A 款");
  });

  it("超過剩餘抽數時拒絕", async () => {
    await openSet({ totalDraws: 3 });
    const res = await scan({ barcode: "4710000000001", quantity: 4 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "exceeds", remaining: 3 });
    expect((await api.get("/sales")).body).toHaveLength(0);
  });

  it("包套記剩餘抽數並完售，之後刷不到", async () => {
    const set = await openSet({ totalDraws: 10, openingDraws: 2, openingRevenue: 200 });
    const res = await scan({ setId: set.id, type: "package", amount: 500 });
    expect(res.body.sale).toMatchObject({ quantity: 8, amount: 500, type: "package" });
    expect(res.body.set.status).toBe("sold_out");
    expect(res.body.set.completedAt).toBe(res.body.sale.soldAt);
    expect((await scan({ barcode: "4710000000001" })).body.code).toBe("not_found");
  });
});

describe("撤銷上一筆", () => {
  it("撤銷今天本分店最近一筆櫃檯銷售，不碰補登，完售會變回販售中", async () => {
    const set = await openSet({ totalDraws: 2 });
    await scan({ barcode: "4710000000001" });
    const last = await scan({ barcode: "4710000000001" });
    expect(last.body.set.status).toBe("sold_out");
    await api.post("/sales", {
      clientId: clientId(),
      setId: set.id,
      quantity: 1,
      amount: 100,
      soldAt: new Date().toISOString(),
      force: true,
    });

    const r1 = await api.post("/counter/revoke-last", { branchId: 1 });
    expect(r1.body.sale.id).toBe(last.body.sale.id);
    const r2 = await api.post("/counter/revoke-last", { branchId: 1 });
    expect(r2.body.sale.type).toBe("normal");
    expect(r2.body.set).toMatchObject({ soldDraws: 1, status: "selling", completedAt: null });
    const r3 = await api.post("/counter/revoke-last", { branchId: 1 });
    expect(r3.body.code).toBe("nothing_to_revoke");
  });

  it("不會撤到昨天的銷售", async () => {
    await openSet();
    const res = await scan({ barcode: "4710000000001" });
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await ctx.env.DB.prepare("UPDATE sales SET created_at = ? WHERE id = ?").bind(yesterday, res.body.sale.id).run();
    expect((await api.post("/counter/revoke-last", { branchId: 1 })).status).toBe(404);
  });

  it("撤銷後完售時間清空", async () => {
    await openSet({ totalDraws: 1 });
    expect((await scan({ barcode: "4710000000001" })).body.set.completedAt).not.toBeNull();
    const r = await api.post("/counter/revoke-last", { branchId: 1 });
    expect(r.body.set).toMatchObject({ status: "selling", completedAt: null, soldDraws: 0 });
  });
});

describe("回本計算", () => {
  it("期初算進回本", async () => {
    const set = await openSet({ cost: 1000, openingDraws: 4, openingRevenue: 400 });
    expect(set).toMatchObject({ soldDraws: 4, revenue: 400, breakevenDraws: null });
  });

  it("回本線依實際賣出時間累計，補登會插回它的位置", async () => {
    const set = await openSet({ cost: 1000, openingDraws: 2, openingRevenue: 200 });
    await scan({ barcode: "4710000000001", quantity: 5 }); // 現在：+500
    const earlier = new Date(Date.now() - 3_600_000).toISOString();
    const backfill = await api.post("/sales", {
      clientId: clientId(),
      setId: set.id,
      quantity: 8,
      amount: 800,
      soldAt: earlier,
    });
    // 依賣出時間：期初 2 抽 $200 → 補登 +8 抽 = 10 抽、$1000 → 達到成本
    // （如果照登打時間會是 2+5+8 = 15）
    expect(backfill.body.set).toMatchObject({ soldDraws: 15, revenue: 1500, breakevenDraws: 10 });
  });

  it("期初已回本時回本線就在期初", async () => {
    const set = await openSet({ cost: 300, openingDraws: 3, openingRevenue: 300 });
    expect(set.breakevenDraws).toBe(3);
  });

  it("一筆多抽時，回本線落在這筆裡達到成本的那一抽", async () => {
    const set = await openSet({ cost: 1000, totalDraws: 30 });
    await scan({ barcode: "4710000000001", quantity: 3 }); // 3 抽 $300
    // 包套 27 抽 $1350（平均每抽 $50）：還差 $700 → 第 14 抽達到 → 3 + 14 = 17
    await scan({ setId: set.id, type: "package", amount: 1350 });
    expect((await api.get(`/sets/${set.id}`)).body.breakevenDraws).toBe(17);
  });

  it("改成本會重算回本線", async () => {
    const set = await openSet({ cost: 1000 });
    await scan({ barcode: "4710000000001", quantity: 6 });
    const res = await api.patch(`/sets/${set.id}`, { cost: 500 });
    expect(res.body.breakevenDraws).toBe(5);
  });
});

describe("補登與修改", () => {
  it("補登超過總抽數要先確認，確認後可以強制存", async () => {
    const set = await openSet({ totalDraws: 5 });
    const body = { clientId: clientId(), setId: set.id, quantity: 6, amount: 600, soldAt: new Date().toISOString() };
    const first = await api.post("/sales", body);
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({ code: "exceeds_confirm", remaining: 5 });
    const forced = await api.post("/sales", { ...body, force: true });
    expect(forced.status).toBe(201);
    expect(forced.body.set).toMatchObject({ soldDraws: 6, status: "sold_out" });
  });

  it("補登分店預設帶入這套目前的分店", async () => {
    const set = await openSet({ branchId: 2 });
    const res = await api.post("/sales", {
      clientId: clientId(),
      setId: set.id,
      quantity: 1,
      amount: 100,
      soldAt: new Date().toISOString(),
    });
    expect(res.body.sale).toMatchObject({ branchId: 2, type: "backfill" });
  });

  it("修改數量超過也要確認；修改紀錄保留前後的值", async () => {
    await openSet({ totalDraws: 3 });
    const sale = (await scan({ barcode: "4710000000001" })).body.sale;
    expect((await api.patch(`/sales/${sale.id}`, { quantity: 5 })).body.code).toBe("exceeds_confirm");
    const ok = await api.patch(`/sales/${sale.id}`, { quantity: 2, amount: 150 });
    expect(ok.body.set).toMatchObject({ soldDraws: 2, revenue: 150 });
    await api.post(`/sales/${sale.id}/revoke`);
    expect((await api.patch(`/sales/${sale.id}`, { amount: 1 })).body.code).toBe("revoked");

    const audit = (await api.get(`/audit?entity=sale&entityId=${sale.id}`)).body;
    expect(audit.map((a: { action: string }) => a.action)).toEqual(["create", "update", "revoke"]);
    expect(audit[1].before).toMatchObject({ quantity: 1, amount: 100 });
    expect(audit[1].after).toMatchObject({ quantity: 2, amount: 150 });
    expect(audit[2].after.revokedAt).not.toBeNull();
  });

  it("賣超之後只改品名不檢查總抽數，改總抽數才檢查", async () => {
    const set = await openSet({ totalDraws: 2 });
    await api.post("/sales", {
      clientId: clientId(),
      setId: set.id,
      quantity: 3,
      amount: 300,
      soldAt: new Date().toISOString(),
      force: true,
    });
    expect((await api.patch(`/sets/${set.id}`, { name: "改名" })).status).toBe(200);
    expect((await api.patch(`/sets/${set.id}`, { totalDraws: 2 })).status).toBe(200);
    expect((await api.patch(`/sets/${set.id}`, { totalDraws: 1 })).body.code).toBe("total_below_sold");
  });
});

describe("套管理", () => {
  it("開套時帶入同條碼最近一套的資料", async () => {
    await openSet({ name: "舊款", pricePerDraw: 120 });
    const res = await api.get("/sets/prefill?barcode=4710000000001");
    expect(res.body).toMatchObject({ name: "舊款", pricePerDraw: 120, cost: 1000, totalDraws: 20 });
    expect((await api.get("/sets/prefill?barcode=none")).body).toBeNull();
  });

  it("有銷售紀錄（含已撤銷）的套不能刪", async () => {
    const used = await openSet();
    const sale = (await scan({ barcode: "4710000000001" })).body.sale;
    await api.post(`/sales/${sale.id}/revoke`);
    expect((await api.delete(`/sets/${used.id}`)).body.code).toBe("has_sales");

    const unused = await openSet({ barcode: "other" });
    expect((await api.delete(`/sets/${unused.id}`)).status).toBe(200);
    const audit = (await api.get(`/audit?entity=set&entityId=${unused.id}`)).body;
    expect(audit.map((a: { action: string }) => a.action)).toEqual(["create", "delete"]);
  });

  it("調貨後在新分店刷得到，舊銷售仍算原分店", async () => {
    const set = await openSet();
    await scan({ barcode: "4710000000001", quantity: 2 });
    const moved = await api.post(`/sets/${set.id}/transfer`, { branchId: 2 });
    expect(moved.body).toMatchObject({ branchId: 2, soldDraws: 2 });
    await api.post("/counter/scan", { clientId: clientId(), branchId: 2, barcode: "4710000000001" });

    const today = taipeiDate();
    const report = (await api.get(`/reports?from=${today}&to=${today}`)).body;
    expect(report.totals).toEqual([
      { branchId: 1, revenue: 200, draws: 2 },
      { branchId: 2, revenue: 100, draws: 1 },
    ]);
  });
});

describe("看板與版本號", () => {
  it("寫入會讓版本號加 1，讀取不會", async () => {
    const v0 = await version();
    await openSet();
    const v1 = await version();
    expect(v1).toBe(v0 + 1);
    await api.get("/dashboard");
    expect(await version()).toBe(v1);
    await scan({ barcode: "4710000000001" });
    expect(await version()).toBe(v1 + 1);
  });

  it("看板只列販售中的套，已完售清單列完售的", async () => {
    await openSet({ name: "賣完的", barcode: "a", totalDraws: 1 });
    await openSet({ name: "還在賣", barcode: "b" });
    await scan({ barcode: "a" });
    const dash = (await api.get("/dashboard")).body;
    expect(dash.sets.map((s: SetDto) => s.name)).toEqual(["還在賣"]);
    expect(dash.branches).toHaveLength(2);
    const done = (await api.get("/completed")).body;
    expect(done.map((s: SetDto) => s.name)).toEqual(["賣完的"]);
  });
});

describe("報表", () => {
  it("不含期初、不含已撤銷，依台灣時間換日", async () => {
    const set = await openSet({ cost: 500, openingDraws: 5, openingRevenue: 500 });
    const sale = (await scan({ barcode: "4710000000001", quantity: 2 })).body.sale;
    await scan({ barcode: "4710000000001" });
    await api.post(`/sales/${sale.id}/revoke`);
    // 台灣時間 2025-03-01 00:30 = UTC 02-28 16:30
    await api.post("/sales", {
      clientId: clientId(),
      setId: set.id,
      quantity: 1,
      amount: 90,
      soldAt: "2025-02-28T16:30:00.000Z",
    });

    const mar1 = (await api.get("/reports?from=2025-03-01&to=2025-03-01")).body;
    expect(mar1.totals).toEqual([{ branchId: 1, revenue: 90, draws: 1 }]);
    expect(mar1.days).toEqual([{ date: "2025-03-01", branchId: 1, revenue: 90, draws: 1 }]);
    const feb28 = (await api.get("/reports?from=2025-02-28&to=2025-02-28")).body;
    expect(feb28.totals).toEqual([]);

    // 今天只有沒撤銷的那 1 抽 $100
    const today = taipeiDate();
    const todayReport = (await api.get(`/reports?from=${today}&to=${today}`)).body;
    expect(todayReport.totals).toEqual([{ branchId: 1, revenue: 100, draws: 1 }]);
  });

  it("期間內完售的套與利潤含期初", async () => {
    await openSet({ cost: 500, totalDraws: 6, openingDraws: 5, openingRevenue: 500 });
    await scan({ barcode: "4710000000001" });
    const today = taipeiDate();
    const report = (await api.get(`/reports?from=${today}&to=${today}`)).body;
    expect(report.completed).toHaveLength(1);
    expect(report.completed[0]).toMatchObject({ revenue: 600, cost: 500 });
    expect(report.perSet).toEqual([
      expect.objectContaining({ setName: "測試賞", branchId: 1, draws: 1, revenue: 100 }),
    ]);
  });
});
