import type {
  AuditAction,
  AuthUser,
  Branch,
  PublicSetDto,
  SaleDto,
  SaleType,
  SetDto,
  SetStatus,
} from "../shared/types";
import { HttpError } from "./http";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** 做這次修改的人，記進修改紀錄和銷售 */
export interface Actor {
  id: string;
  name: string;
}

export function actorOf(user: AuthUser): Actor {
  return { id: user.id, name: user.displayName };
}

interface SetRow {
  id: string;
  barcode: string;
  name: string;
  branch_id: number;
  branch_name: string;
  cost: number | null;
  price_per_draw: number;
  total_draws: number;
  opening_draws: number;
  opening_revenue: number;
  sold_draws: number;
  revenue: number;
  breakeven_draws: number | null;
  status: SetStatus;
  created_at: string;
  completed_at: string | null;
  has_sales?: number;
}

interface SaleRow {
  id: string;
  client_id: string;
  set_id: string;
  set_name: string;
  branch_id: number;
  branch_name: string;
  quantity: number;
  amount: number;
  type: SaleType;
  sold_at: string;
  created_at: string;
  revoked_at: string | null;
  created_by_name: string | null;
}

export const SET_SELECT = `SELECT s.*, b.name AS branch_name FROM sets s JOIN branches b ON b.id = s.branch_id`;

export const SALE_SELECT = `SELECT sa.*, s.name AS set_name, b.name AS branch_name, u.display_name AS created_by_name
  FROM sales sa
  JOIN sets s ON s.id = sa.set_id
  JOIN branches b ON b.id = sa.branch_id
  LEFT JOIN users u ON u.id = sa.created_by`;

export function toSet(r: SetRow): SetDto {
  const dto: SetDto = {
    id: r.id,
    barcode: r.barcode,
    name: r.name,
    branchId: r.branch_id,
    branchName: r.branch_name,
    cost: r.cost,
    pricePerDraw: r.price_per_draw,
    totalDraws: r.total_draws,
    openingDraws: r.opening_draws,
    openingRevenue: r.opening_revenue,
    soldDraws: r.sold_draws,
    revenue: r.revenue,
    breakevenDraws: r.breakeven_draws,
    status: r.status,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
  if (r.has_sales !== undefined) dto.hasSales = r.has_sales === 1;
  return dto;
}

/** 給工作人員的套資料：逐欄挑出來，沒挑到的（成本、已收金額、回本線…）一律不送 */
export function toPublicSet(s: SetDto): PublicSetDto {
  return {
    id: s.id,
    barcode: s.barcode,
    name: s.name,
    branchId: s.branchId,
    branchName: s.branchName,
    pricePerDraw: s.pricePerDraw,
    totalDraws: s.totalDraws,
    soldDraws: s.soldDraws,
    status: s.status,
    createdAt: s.createdAt,
    completedAt: s.completedAt,
  };
}

export function toSale(r: SaleRow): SaleDto {
  return {
    id: r.id,
    clientId: r.client_id,
    setId: r.set_id,
    setName: r.set_name,
    branchId: r.branch_id,
    branchName: r.branch_name,
    quantity: r.quantity,
    amount: r.amount,
    type: r.type,
    soldAt: r.sold_at,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    createdByName: r.created_by_name,
  };
}

export async function querySets(db: D1Database, sql: string, ...params: unknown[]): Promise<SetDto[]> {
  const { results } = await db.prepare(sql).bind(...params).all<SetRow>();
  return results.map(toSet);
}

export async function querySales(db: D1Database, sql: string, ...params: unknown[]): Promise<SaleDto[]> {
  const { results } = await db.prepare(sql).bind(...params).all<SaleRow>();
  return results.map(toSale);
}

export async function findSet(db: D1Database, id: string): Promise<SetDto | null> {
  const row = await db.prepare(`${SET_SELECT} WHERE s.id = ?`).bind(id).first<SetRow>();
  return row ? toSet(row) : null;
}

export async function getSet(db: D1Database, id: string): Promise<SetDto> {
  const set = await findSet(db, id);
  if (!set) throw new HttpError(404, "set_not_found", "找不到這一套");
  return set;
}

export async function findSale(db: D1Database, id: string): Promise<SaleDto | null> {
  const row = await db.prepare(`${SALE_SELECT} WHERE sa.id = ?`).bind(id).first<SaleRow>();
  return row ? toSale(row) : null;
}

export async function getSale(db: D1Database, id: string): Promise<SaleDto> {
  const sale = await findSale(db, id);
  if (!sale) throw new HttpError(404, "sale_not_found", "找不到這筆銷售");
  return sale;
}

export async function findSaleByClientId(db: D1Database, clientId: string): Promise<SaleDto | null> {
  const row = await db.prepare(`${SALE_SELECT} WHERE sa.client_id = ?`).bind(clientId).first<SaleRow>();
  return row ? toSale(row) : null;
}

export async function listBranches(db: D1Database): Promise<Branch[]> {
  const { results } = await db.prepare(`SELECT id, name FROM branches ORDER BY id`).all<Branch>();
  return results;
}

export async function getBranch(db: D1Database, id: number): Promise<Branch> {
  const branch = await db.prepare(`SELECT id, name FROM branches WHERE id = ?`).bind(id).first<Branch>();
  if (!branch) throw new HttpError(400, "branch_not_found", "沒有這家分店");
  return branch;
}

export async function getVersion(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT value FROM meta WHERE key = 'data_version'`).first<{ value: string }>();
  return Number(row?.value ?? 0);
}

/** 最後修改版本號加 1；每個寫入的 batch 都要帶這一句 */
export function bumpVersion(db: D1Database): D1PreparedStatement {
  return db.prepare(`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'data_version'`);
}

/**
 * 依 SPEC「計算」重算一套的已賣抽數、已收金額、回本線、狀態與完售時間。
 * 回傳兩句，要放在同一個 batch 裡、接在改動銷售或套的語句後面。
 */
export function recomputeSet(db: D1Database, setId: string, now: string): D1PreparedStatement[] {
  const totals = db
    .prepare(
      `UPDATE sets SET
        sold_draws = opening_draws
          + COALESCE((SELECT SUM(quantity) FROM sales WHERE set_id = ?1 AND revoked_at IS NULL), 0),
        revenue = opening_revenue
          + COALESCE((SELECT SUM(amount) FROM sales WHERE set_id = ?1 AND revoked_at IS NULL), 0),
        breakeven_draws = CASE
          WHEN cost IS NULL THEN NULL
          WHEN opening_revenue >= cost THEN opening_draws
          -- 找出累計實收第一次達到成本的那筆；一筆多抽時用這筆的平均每抽金額推算是第幾抽
          -- （整數無條件進位：(a + b - 1) / b）
          ELSE (
            SELECT opening_draws + (c.cum_qty - c.quantity)
              + ((cost - opening_revenue - (c.cum_amt - c.amount)) * c.quantity + c.amount - 1) / c.amount
            FROM (
              SELECT sold_at, created_at, id, quantity, amount,
                SUM(quantity) OVER w AS cum_qty,
                SUM(amount) OVER w AS cum_amt
              FROM sales
              WHERE set_id = ?1 AND revoked_at IS NULL
              WINDOW w AS (ORDER BY sold_at, created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
            ) AS c
            WHERE opening_revenue + c.cum_amt >= cost
            ORDER BY c.sold_at, c.created_at, c.id
            LIMIT 1
          )
        END
      WHERE id = ?1`,
    )
    .bind(setId);
  // 完售時間取最後一筆銷售的實際賣出時間；只靠期初就賣完時用現在
  const status = db
    .prepare(
      `UPDATE sets SET
        status = CASE WHEN sold_draws >= total_draws THEN 'sold_out' ELSE 'selling' END,
        completed_at = CASE
          WHEN sold_draws >= total_draws THEN COALESCE(
            completed_at,
            (SELECT MAX(sold_at) FROM sales WHERE set_id = ?1 AND revoked_at IS NULL),
            ?2
          )
          ELSE NULL
        END
      WHERE id = ?1`,
    )
    .bind(setId, now);
  return [totals, status];
}

export function auditStmt(
  db: D1Database,
  entity: "sale" | "set",
  entityId: string,
  action: AuditAction,
  before: object | null,
  after: object | null,
  actor: Actor,
  now: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (entity, entity_id, action, "before", "after", user_id, user_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entity,
      entityId,
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      actor.id,
      actor.name,
      now,
    );
}

/** 修改紀錄裡存的套欄位 */
export function setSnapshot(s: SetDto) {
  return {
    barcode: s.barcode,
    name: s.name,
    branchId: s.branchId,
    branchName: s.branchName,
    cost: s.cost,
    pricePerDraw: s.pricePerDraw,
    totalDraws: s.totalDraws,
    openingDraws: s.openingDraws,
    openingRevenue: s.openingRevenue,
  };
}

/** 修改紀錄裡存的銷售欄位 */
export function saleSnapshot(s: Omit<SaleDto, "id" | "clientId" | "createdAt" | "createdByName">) {
  return {
    setId: s.setId,
    setName: s.setName,
    branchId: s.branchId,
    branchName: s.branchName,
    quantity: s.quantity,
    amount: s.amount,
    type: s.type,
    soldAt: s.soldAt,
    revokedAt: s.revokedAt,
  };
}
