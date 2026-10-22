import { Hono } from "hono";
import type { SetPrefill } from "../../shared/types";
import { requireAdmin } from "../auth";
import {
  actorOf,
  auditStmt,
  bumpVersion,
  getBranch,
  getSet,
  newId,
  nowIso,
  querySets,
  recomputeSet,
  SET_SELECT,
  setSnapshot,
  toPublicSet,
} from "../db";
import type { AppEnv } from "../env";
import {
  badRequest,
  HttpError,
  intField,
  optionalIntField,
  optionalStringField,
  readJson,
  stringField,
} from "../http";

export const setRoutes = new Hono<AppEnv>();

setRoutes.get("/sets", requireAdmin, async (c) => {
  const where: string[] = [];
  const params: unknown[] = [];
  const status = c.req.query("status");
  if (status === "selling" || status === "sold_out") {
    where.push("s.status = ?");
    params.push(status);
  }
  if (c.req.query("missingCost") === "1") where.push("s.cost IS NULL");
  const branchId = Number(c.req.query("branchId"));
  if (Number.isSafeInteger(branchId) && branchId > 0) {
    where.push("s.branch_id = ?");
    params.push(branchId);
  }
  const q = c.req.query("q")?.trim();
  if (q) {
    where.push("(s.name LIKE ? OR s.barcode = ?)");
    params.push(`%${q}%`, q);
  }
  const sql = `SELECT s.*, b.name AS branch_name,
      EXISTS (SELECT 1 FROM sales WHERE set_id = s.id) AS has_sales
    FROM sets s JOIN branches b ON b.id = s.branch_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY s.created_at DESC LIMIT 1000`;
  return c.json(await querySets(c.env.DB, sql, ...params));
});

/** 開套時帶入同條碼最近一套的資料；工作人員拿不到成本 */
setRoutes.get("/sets/prefill", async (c) => {
  const barcode = c.req.query("barcode")?.trim();
  if (!barcode) return c.json(null);
  const [latest] = await querySets(
    c.env.DB,
    `${SET_SELECT} WHERE s.barcode = ? ORDER BY s.created_at DESC LIMIT 1`,
    barcode,
  );
  if (!latest) return c.json(null);
  const prefill: SetPrefill = {
    name: latest.name,
    pricePerDraw: latest.pricePerDraw,
    totalDraws: latest.totalDraws,
  };
  if (c.get("user").role === "admin") prefill.cost = latest.cost;
  return c.json(prefill);
});

setRoutes.get("/sets/:id", requireAdmin, async (c) => c.json(await getSet(c.env.DB, c.req.param("id"))));

/**
 * 開套。
 * 工作人員不填成本和期初：同條碼有舊套就沿用最近一套的成本，新款成本留空（待補）。
 */
setRoutes.post("/sets", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const isAdmin = user.role === "admin";
  const body = await readJson(c);
  const barcode = stringField(body, "barcode", "條碼", 100);
  const name = stringField(body, "name", "品名");
  const branchId = intField(body, "branchId", "分店");
  const pricePerDraw = intField(body, "pricePerDraw", "每抽價格", { min: 1 });
  const totalDraws = intField(body, "totalDraws", "總抽數", { min: 1 });
  let cost: number | null;
  let openingDraws = 0;
  let openingRevenue = 0;
  if (isAdmin) {
    cost = intField(body, "cost", "成本", { min: 0 });
    openingDraws = optionalIntField(body, "openingDraws", "期初已賣抽數", { min: 0, max: totalDraws }) ?? 0;
    openingRevenue = optionalIntField(body, "openingRevenue", "期初已收金額", { min: 0 }) ?? 0;
  } else {
    const previous = await db
      .prepare(`SELECT cost FROM sets WHERE barcode = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(barcode)
      .first<{ cost: number | null }>();
    cost = previous?.cost ?? null;
  }
  const branch = await getBranch(db, branchId);

  const id = newId();
  const now = nowIso();
  const snapshot = {
    barcode,
    name,
    branchId,
    branchName: branch.name,
    cost,
    pricePerDraw,
    totalDraws,
    openingDraws,
    openingRevenue,
  };
  await db.batch([
    db
      .prepare(
        `INSERT INTO sets (id, barcode, name, branch_id, cost, price_per_draw, total_draws,
           opening_draws, opening_revenue, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, barcode, name, branchId, cost, pricePerDraw, totalDraws, openingDraws, openingRevenue, now),
    auditStmt(db, "set", id, "create", null, snapshot, actorOf(user), now),
    ...recomputeSet(db, id, now),
    bumpVersion(db),
  ]);
  const created = await getSet(db, id);
  return c.json(isAdmin ? created : toPublicSet(created), 201);
});

/** 編輯品名、成本、每抽價格、總抽數 */
setRoutes.patch("/sets/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const before = await getSet(db, c.req.param("id"));
  const body = await readJson(c);
  const after = {
    ...before,
    name: optionalStringField(body, "name", "品名") ?? before.name,
    cost: optionalIntField(body, "cost", "成本", { min: 0 }) ?? before.cost,
    pricePerDraw: optionalIntField(body, "pricePerDraw", "每抽價格", { min: 1 }) ?? before.pricePerDraw,
    totalDraws: optionalIntField(body, "totalDraws", "總抽數", { min: 1 }) ?? before.totalDraws,
  };
  if (after.totalDraws !== before.totalDraws && after.totalDraws < before.soldDraws) {
    throw new HttpError(409, "total_below_sold", `總抽數不能小於已賣抽數（${before.soldDraws}）`);
  }
  const now = nowIso();
  await db.batch([
    db
      .prepare(`UPDATE sets SET name = ?, cost = ?, price_per_draw = ?, total_draws = ? WHERE id = ?`)
      .bind(after.name, after.cost, after.pricePerDraw, after.totalDraws, before.id),
    auditStmt(db, "set", before.id, "update", setSnapshot(before), setSnapshot(after), actorOf(c.get("user")), now),
    ...recomputeSet(db, before.id, now),
    bumpVersion(db),
  ]);
  return c.json(await getSet(db, before.id));
});

/** 調貨：已賣抽數跟著套走，過去的銷售仍算在原本賣出的分店 */
setRoutes.post("/sets/:id/transfer", requireAdmin, async (c) => {
  const db = c.env.DB;
  const before = await getSet(db, c.req.param("id"));
  const body = await readJson(c);
  const branch = await getBranch(db, intField(body, "branchId", "分店"));
  if (branch.id === before.branchId) throw badRequest("這套已經在這家分店");
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE sets SET branch_id = ? WHERE id = ?`).bind(branch.id, before.id),
    auditStmt(
      db,
      "set",
      before.id,
      "transfer",
      { branchId: before.branchId, branchName: before.branchName },
      { branchId: branch.id, branchName: branch.name },
      actorOf(c.get("user")),
      now,
    ),
    bumpVersion(db),
  ]);
  return c.json(await getSet(db, before.id));
});

/** 沒有任何銷售紀錄（含已撤銷）才能刪 */
setRoutes.delete("/sets/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const before = await getSet(db, c.req.param("id"));
  const used = await db.prepare(`SELECT 1 FROM sales WHERE set_id = ? LIMIT 1`).bind(before.id).first();
  if (used) throw new HttpError(409, "has_sales", "這套已經有銷售紀錄，不能刪除");
  const now = nowIso();
  await db.batch([
    db.prepare(`DELETE FROM sets WHERE id = ?`).bind(before.id),
    auditStmt(db, "set", before.id, "delete", setSnapshot(before), null, actorOf(c.get("user")), now),
    bumpVersion(db),
  ]);
  return c.json({ ok: true });
});
