import type { SaleType, SaleWithSet } from "../shared/types";
import {
  type Actor,
  auditStmt,
  bumpVersion,
  findSaleByClientId,
  getBranch,
  getSale,
  getSet,
  newId,
  nowIso,
  recomputeSet,
  saleSnapshot,
} from "./db";
import { HttpError } from "./http";

export interface NewSale {
  clientId: string;
  setId: string;
  branchId: number;
  quantity: number;
  amount: number;
  type: SaleType;
  soldAt: string;
  /** true：在資料庫裡再檢查一次剩餘抽數，不夠就不寫入（櫃檯用） */
  guardRemaining: boolean;
}

/**
 * 新增一筆銷售。同一個 clientId 只會記一次：重送時回傳原本那筆（duplicate = true）。
 */
export async function createSale(
  db: D1Database,
  input: NewSale,
  actor: Actor,
): Promise<SaleWithSet & { duplicate: boolean }> {
  const existing = await findSaleByClientId(db, input.clientId);
  if (existing) return { sale: existing, set: await getSet(db, existing.setId), duplicate: true };

  const set = await getSet(db, input.setId);
  const branch = await getBranch(db, input.branchId);
  const id = newId();
  const now = nowIso();
  const values = [
    id,
    input.clientId,
    input.setId,
    input.branchId,
    input.quantity,
    input.amount,
    input.type,
    input.soldAt,
    now,
    actor.id,
  ];
  const insert = input.guardRemaining
    ? db
        .prepare(
          `INSERT INTO sales (id, client_id, set_id, branch_id, quantity, amount, type, sold_at, created_at, created_by)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 FROM sets
           WHERE id = ?3 AND status = 'selling' AND total_draws - sold_draws >= ?5
           ON CONFLICT (client_id) DO NOTHING`,
        )
        .bind(...values)
    : db
        .prepare(
          `INSERT INTO sales (id, client_id, set_id, branch_id, quantity, amount, type, sold_at, created_at, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
           ON CONFLICT (client_id) DO NOTHING`,
        )
        .bind(...values);
  const after = saleSnapshot({
    setId: set.id,
    setName: set.name,
    branchId: branch.id,
    branchName: branch.name,
    quantity: input.quantity,
    amount: input.amount,
    type: input.type,
    soldAt: input.soldAt,
    revokedAt: null,
  });
  // 只有真的寫入了（id 是這次產生的）才記修改紀錄
  const audit = db
    .prepare(
      `INSERT INTO audit_log (entity, entity_id, action, "before", "after", user_id, user_name, created_at)
       SELECT 'sale', ?1, 'create', NULL, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM sales WHERE id = ?1)`,
    )
    .bind(id, JSON.stringify(after), actor.id, actor.name, now);

  await db.batch([insert, audit, ...recomputeSet(db, set.id, now), bumpVersion(db)]);

  const sale = await findSaleByClientId(db, input.clientId);
  if (!sale) {
    const fresh = await getSet(db, set.id);
    throw new HttpError(409, "exceeds", `剩餘抽數不夠，只剩 ${fresh.totalDraws - fresh.soldDraws} 抽`, {
      remaining: fresh.totalDraws - fresh.soldDraws,
    });
  }
  return { sale, set: await getSet(db, sale.setId), duplicate: sale.id !== id };
}

export interface SalePatch {
  quantity?: number;
  amount?: number;
  soldAt?: string;
}

/** 修改數量、實收金額、實際賣出時間。force = false 時，超過總抽數會回 409 要求確認。 */
export async function updateSale(
  db: D1Database,
  saleId: string,
  patch: SalePatch,
  force: boolean,
  actor: Actor,
): Promise<SaleWithSet> {
  const before = await getSale(db, saleId);
  if (before.revokedAt) throw new HttpError(409, "revoked", "這筆已經撤銷，不能修改");
  const after = {
    ...before,
    quantity: patch.quantity ?? before.quantity,
    amount: patch.amount ?? before.amount,
    soldAt: patch.soldAt ?? before.soldAt,
  };
  const set = await getSet(db, before.setId);
  const remaining = set.totalDraws - set.soldDraws;
  const added = after.quantity - before.quantity;
  if (added > 0 && added > remaining && !force) {
    throw new HttpError(409, "exceeds_confirm", `改完會超過總抽數（這套只剩 ${remaining} 抽）`, { remaining });
  }
  const now = nowIso();
  await db.batch([
    db
      .prepare(`UPDATE sales SET quantity = ?, amount = ?, sold_at = ? WHERE id = ? AND revoked_at IS NULL`)
      .bind(after.quantity, after.amount, after.soldAt, saleId),
    auditStmt(db, "sale", saleId, "update", saleSnapshot(before), saleSnapshot(after), actor, now),
    ...recomputeSet(db, set.id, now),
    bumpVersion(db),
  ]);
  return { sale: await getSale(db, saleId), set: await getSet(db, set.id) };
}

export async function revokeSale(db: D1Database, saleId: string, actor: Actor): Promise<SaleWithSet> {
  const before = await getSale(db, saleId);
  if (before.revokedAt) throw new HttpError(409, "revoked", "這筆已經撤銷過了");
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE sales SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).bind(now, saleId),
    auditStmt(
      db,
      "sale",
      saleId,
      "revoke",
      saleSnapshot(before),
      saleSnapshot({ ...before, revokedAt: now }),
      actor,
      now,
    ),
    ...recomputeSet(db, before.setId, now),
    bumpVersion(db),
  ]);
  return { sale: await getSale(db, saleId), set: await getSet(db, before.setId) };
}
