import { Hono } from "hono";
import { taipeiDate, taipeiDayStartIso } from "../../shared/time";
import type { CounterSale, PublicSetDto, ScanResponse, SetDto } from "../../shared/types";
import {
  actorOf,
  findSaleByClientId,
  getBranch,
  getSale,
  getSet,
  nowIso,
  querySets,
  SET_SELECT,
  toPublicSet,
} from "../db";
import type { AppEnv } from "../env";
import { HttpError, intField, optionalIntField, optionalStringField, readJson, stringField } from "../http";
import { createSale, revokeSale, updateSale } from "../sales-service";

/**
 * 櫃檯：管理員和工作人員都能用。
 * 回傳的套資料一律是 PublicSetDto（沒有成本、已收金額、回本線）。
 */
export const counterRoutes = new Hono<AppEnv>();

/** 今天（台灣時間）本分店最近一筆還沒撤銷的櫃檯銷售 */
async function latestCounterSaleId(db: D1Database, branchId: number): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM sales
       WHERE branch_id = ? AND revoked_at IS NULL AND type IN ('normal', 'package') AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(branchId, taipeiDayStartIso(taipeiDate()))
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * 刷條碼／包套。
 * - 帶 barcode：只找本分店、販售中、條碼相符的套；多套時回 choose 讓櫃檯選，選好後帶 setId 重送（同一個 clientId）。
 * - 帶 setId：直接記這一套。
 */
counterRoutes.post("/counter/scan", async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  const clientId = stringField(body, "clientId", "clientId", 100);
  const branchId = intField(body, "branchId", "分店");
  const isPackage = body.type === "package";

  const existing = await findSaleByClientId(db, clientId);
  if (existing) {
    const set = toPublicSet(await getSet(db, existing.setId));
    return c.json<ScanResponse>({ status: "recorded", sale: existing, set, duplicate: true });
  }
  await getBranch(db, branchId);

  let set: SetDto;
  const setId = optionalStringField(body, "setId", "setId", 100);
  if (setId) {
    set = await getSet(db, setId);
    if (set.branchId !== branchId || set.status !== "selling") {
      throw new HttpError(409, "not_available", `「${set.name}」不在本分店販售中`);
    }
  } else {
    const barcode = stringField(body, "barcode", "條碼", 100);
    const candidates = await querySets(
      db,
      `${SET_SELECT} WHERE s.barcode = ? AND s.branch_id = ? AND s.status = 'selling' ORDER BY s.created_at`,
      barcode,
      branchId,
    );
    if (candidates.length === 0) {
      throw new HttpError(404, "not_found", `找不到條碼 ${barcode} 的販售中套`);
    }
    if (candidates.length > 1) {
      return c.json<ScanResponse>({ status: "choose", candidates: candidates.map(toPublicSet) });
    }
    set = candidates[0];
  }

  const remaining = set.totalDraws - set.soldDraws;
  let quantity: number;
  let amount: number;
  if (isPackage) {
    quantity = remaining;
    amount = intField(body, "amount", "包套價", { min: 0 });
  } else {
    quantity = optionalIntField(body, "quantity", "數量", { min: 1 }) ?? 1;
    amount = quantity * set.pricePerDraw;
  }
  if (quantity <= 0 || quantity > remaining) {
    throw new HttpError(409, "exceeds", `「${set.name}」只剩 ${remaining} 抽`, { remaining });
  }

  const result = await createSale(
    db,
    {
      clientId,
      setId: set.id,
      branchId,
      quantity,
      amount,
      type: isPackage ? "package" : "normal",
      soldAt: nowIso(),
      guardRemaining: true,
    },
    actorOf(c.get("user")),
  );
  return c.json<ScanResponse>({
    status: "recorded",
    sale: result.sale,
    set: toPublicSet(result.set),
    duplicate: result.duplicate,
  });
});

/** 斷線後確認某次刷條碼有沒有記到 */
counterRoutes.get("/counter/sale-by-client/:clientId", async (c) => {
  const sale = await findSaleByClientId(c.env.DB, c.req.param("clientId"));
  return c.json({ sale });
});

/** 打開櫃檯頁時帶出最近一筆，讓「改金額」接得上 */
counterRoutes.get("/counter/last", async (c) => {
  const db = c.env.DB;
  const id = await latestCounterSaleId(db, Number(c.req.query("branchId")));
  if (!id) return c.json(null);
  const sale = await getSale(db, id);
  return c.json<CounterSale>({ sale, set: toPublicSet(await getSet(db, sale.setId)) });
});

/** 包套時選套用：本分店販售中的套 */
counterRoutes.get("/counter/sets", async (c) => {
  const sets = await querySets(
    c.env.DB,
    `${SET_SELECT} WHERE s.status = 'selling' AND s.branch_id = ? ORDER BY s.created_at DESC`,
    Number(c.req.query("branchId")),
  );
  return c.json<PublicSetDto[]>(sets.map(toPublicSet));
});

/** 改金額：只能改本分店今天櫃檯刷的、還沒撤銷的銷售（其他的請管理員到銷售紀錄改） */
counterRoutes.post("/counter/change-amount", async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  const saleId = stringField(body, "saleId", "銷售", 100);
  const branchId = intField(body, "branchId", "分店");
  const amount = intField(body, "amount", "實收金額", { min: 0 });
  const sale = await getSale(db, saleId);
  const today = taipeiDayStartIso(taipeiDate());
  if (sale.revokedAt || sale.type === "backfill" || sale.branchId !== branchId || sale.createdAt < today) {
    throw new HttpError(409, "not_changeable", "櫃檯只能改本分店今天刷的銷售，其他的請管理員到銷售紀錄修改");
  }
  const result = await updateSale(db, saleId, { amount }, false, actorOf(c.get("user")));
  return c.json<CounterSale>({ sale: result.sale, set: toPublicSet(result.set) });
});

/** 撤銷本分店今天（台灣時間）最近登打的一筆一般或包套銷售 */
counterRoutes.post("/counter/revoke-last", async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  const id = await latestCounterSaleId(db, intField(body, "branchId", "分店"));
  if (!id) throw new HttpError(404, "nothing_to_revoke", "今天沒有可以撤銷的櫃檯銷售");
  const result = await revokeSale(db, id, actorOf(c.get("user")));
  return c.json<CounterSale>({ sale: result.sale, set: toPublicSet(result.set) });
});
