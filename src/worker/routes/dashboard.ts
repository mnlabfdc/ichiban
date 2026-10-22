import { Hono } from "hono";
import type { DashboardResponse } from "../../shared/types";
import { requireAdmin } from "../auth";
import { getVersion, listBranches, querySets, SET_SELECT, toPublicSet } from "../db";
import type { AppEnv } from "../env";

export const dashboardRoutes = new Hono<AppEnv>();

/** 看板每 10 秒查一次，只讀 1 列 */
dashboardRoutes.get("/version", async (c) => c.json({ version: await getVersion(c.env.DB) }));

dashboardRoutes.get("/branches", async (c) => c.json(await listBranches(c.env.DB)));

/** 工作人員拿到的套資料沒有成本、已收金額、回本線 */
dashboardRoutes.get("/dashboard", async (c) => {
  const db = c.env.DB;
  // 先讀版本號：讀完之後如果又有修改，下一次輪詢會看到新版本再重抓
  const version = await getVersion(db);
  const [branches, sets] = await Promise.all([
    listBranches(db),
    querySets(db, `${SET_SELECT} WHERE s.status = 'selling' ORDER BY s.created_at DESC`),
  ]);
  const isAdmin = c.get("user").role === "admin";
  return c.json<DashboardResponse>({ version, branches, sets: isAdmin ? sets : sets.map(toPublicSet) });
});

dashboardRoutes.get("/completed", requireAdmin, async (c) =>
  c.json(
    await querySets(c.env.DB, `${SET_SELECT} WHERE s.status = 'sold_out' ORDER BY s.completed_at DESC LIMIT 1000`),
  ),
);
