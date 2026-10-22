import { Hono } from "hono";
import { addDays, isDateString, taipeiDate, taipeiDayStartIso } from "../../shared/time";
import { requireAdmin } from "../auth";
import { actorOf, getSet, querySales, SALE_SELECT } from "../db";
import type { AppEnv } from "../env";
import { badRequest, HttpError, intField, isoField, optionalIntField, readJson, stringField } from "../http";
import { createSale, revokeSale, updateSale } from "../sales-service";

export const saleRoutes = new Hono<AppEnv>();

/**
 * 可以依套、分店、日期（台灣時間，含頭尾）篩選。
 * 工作人員只能看今天、而且一定要指定分店（櫃檯畫面帶本機分店）。
 */
saleRoutes.get("/sales", async (c) => {
  const isAdmin = c.get("user").role === "admin";
  const where: string[] = [];
  const params: unknown[] = [];
  const setId = c.req.query("setId");
  if (setId) {
    where.push("sa.set_id = ?");
    params.push(setId);
  }
  const branchId = Number(c.req.query("branchId"));
  if (Number.isSafeInteger(branchId) && branchId > 0) {
    where.push("sa.branch_id = ?");
    params.push(branchId);
  } else if (!isAdmin) {
    throw badRequest("請指定分店");
  }
  const today = taipeiDate();
  const from = isAdmin ? c.req.query("from") : today;
  if (from) {
    if (!isDateString(from)) throw badRequest("開始日期格式不對");
    where.push("sa.sold_at >= ?");
    params.push(taipeiDayStartIso(from));
  }
  const to = isAdmin ? c.req.query("to") : today;
  if (to) {
    if (!isDateString(to)) throw badRequest("結束日期格式不對");
    where.push("sa.sold_at < ?");
    params.push(taipeiDayStartIso(addDays(to, 1)));
  }
  if (c.req.query("includeRevoked") !== "1") where.push("sa.revoked_at IS NULL");
  const sql = `${SALE_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY sa.sold_at DESC, sa.created_at DESC LIMIT 1000`;
  return c.json(await querySales(c.env.DB, sql, ...params));
});

function checkNotFuture(iso: string) {
  if (Date.parse(iso) > Date.now() + 60_000) throw badRequest("實際賣出時間不能晚於現在");
}

/** 補登 */
saleRoutes.post("/sales", requireAdmin, async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  const clientId = stringField(body, "clientId", "clientId", 100);
  const set = await getSet(db, stringField(body, "setId", "套", 100));
  const branchId = optionalIntField(body, "branchId", "分店") ?? set.branchId;
  const quantity = intField(body, "quantity", "數量", { min: 1 });
  const amount = intField(body, "amount", "實收金額", { min: 0 });
  const soldAt = isoField(body, "soldAt", "實際賣出時間");
  checkNotFuture(soldAt);
  const remaining = set.totalDraws - set.soldDraws;
  if (quantity > remaining && body.force !== true) {
    throw new HttpError(409, "exceeds_confirm", `補登後會超過總抽數（這套只剩 ${remaining} 抽）`, { remaining });
  }
  const result = await createSale(
    db,
    { clientId, setId: set.id, branchId, quantity, amount, type: "backfill", soldAt, guardRemaining: false },
    actorOf(c.get("user")),
  );
  return c.json(result, 201);
});

saleRoutes.patch("/sales/:id", requireAdmin, async (c) => {
  const body = await readJson(c);
  const soldAt = body.soldAt === undefined ? undefined : isoField(body, "soldAt", "實際賣出時間");
  if (soldAt) checkNotFuture(soldAt);
  const result = await updateSale(
    c.env.DB,
    c.req.param("id"),
    {
      quantity: optionalIntField(body, "quantity", "數量", { min: 1 }),
      amount: optionalIntField(body, "amount", "實收金額", { min: 0 }),
      soldAt,
    },
    body.force === true,
    actorOf(c.get("user")),
  );
  return c.json(result);
});

saleRoutes.post("/sales/:id/revoke", requireAdmin, async (c) =>
  c.json(await revokeSale(c.env.DB, c.req.param("id"), actorOf(c.get("user")))),
);
