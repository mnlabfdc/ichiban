import { Hono } from "hono";
import { addDays, isDateString, taipeiDayStartIso } from "../../shared/time";
import type { ReportResponse } from "../../shared/types";
import { requireAdmin } from "../auth";
import { listBranches, querySets, SET_SELECT } from "../db";
import type { AppEnv } from "../env";
import { badRequest } from "../http";

export const reportRoutes = new Hono<AppEnv>();

interface GroupRow {
  d: string;
  set_id: string;
  set_name: string;
  branch_id: number;
  draws: number;
  revenue: number;
}

/**
 * from～to（台灣時間日期，含頭尾）。依實際賣出時間計算，不含期初、不含已撤銷；
 * 每筆算在刷條碼的那家分店。
 */
reportRoutes.get("/reports", requireAdmin, async (c) => {
  const db = c.env.DB;
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!isDateString(from) || !isDateString(to)) throw badRequest("日期格式不對");
  if (from > to) throw badRequest("開始日期不能晚於結束日期");
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw badRequest("一次最多查一年");
  const start = taipeiDayStartIso(from);
  const end = taipeiDayStartIso(addDays(to, 1));

  // 銷售只掃一次：先依（日、套、分店）分組，其他統計在這裡加總
  const { results: groups } = await db
    .prepare(
      `SELECT g.d, g.set_id, s.name AS set_name, g.branch_id, g.draws, g.revenue
       FROM (
         SELECT date(sold_at, '+8 hours') AS d, set_id, branch_id,
           SUM(quantity) AS draws, SUM(amount) AS revenue
         FROM sales
         WHERE sold_at >= ? AND sold_at < ? AND revoked_at IS NULL
         GROUP BY d, set_id, branch_id
       ) AS g JOIN sets s ON s.id = g.set_id
       ORDER BY g.d`,
    )
    .bind(start, end)
    .all<GroupRow>();

  const totals = new Map<number, { branchId: number; revenue: number; draws: number }>();
  const days = new Map<string, { date: string; branchId: number; revenue: number; draws: number }>();
  const perSet = new Map<string, ReportResponse["perSet"][number]>();
  for (const g of groups) {
    const t = totals.get(g.branch_id) ?? { branchId: g.branch_id, revenue: 0, draws: 0 };
    t.revenue += g.revenue;
    t.draws += g.draws;
    totals.set(g.branch_id, t);

    const dayKey = `${g.d}|${g.branch_id}`;
    const d = days.get(dayKey) ?? { date: g.d, branchId: g.branch_id, revenue: 0, draws: 0 };
    d.revenue += g.revenue;
    d.draws += g.draws;
    days.set(dayKey, d);

    const setKey = `${g.set_id}|${g.branch_id}`;
    const p = perSet.get(setKey) ?? { setId: g.set_id, setName: g.set_name, branchId: g.branch_id, draws: 0, revenue: 0 };
    p.revenue += g.revenue;
    p.draws += g.draws;
    perSet.set(setKey, p);
  }

  const [branches, completed] = await Promise.all([
    listBranches(db),
    querySets(
      db,
      `${SET_SELECT} WHERE s.status = 'sold_out' AND s.completed_at >= ? AND s.completed_at < ? ORDER BY s.completed_at`,
      start,
      end,
    ),
  ]);

  return c.json<ReportResponse>({
    from,
    to,
    branches,
    totals: [...totals.values()].sort((a, b) => a.branchId - b.branchId),
    days: [...days.values()],
    perSet: [...perSet.values()].sort((a, b) => b.revenue - a.revenue),
    completed,
  });
});
