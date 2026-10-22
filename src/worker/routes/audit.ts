import { Hono } from "hono";
import type { AuditEntry } from "../../shared/types";
import { requireAdmin } from "../auth";
import type { AppEnv } from "../env";
import { badRequest } from "../http";

export const auditRoutes = new Hono<AppEnv>();

interface AuditRow {
  id: number;
  entity: AuditEntry["entity"];
  entity_id: string;
  action: AuditEntry["action"];
  before: string | null;
  after: string | null;
  user_name: string | null;
  created_at: string;
}

auditRoutes.get("/audit", requireAdmin, async (c) => {
  const entity = c.req.query("entity");
  const entityId = c.req.query("entityId");
  if ((entity !== "sale" && entity !== "set") || !entityId) throw badRequest("缺少 entity 或 entityId");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id`,
  )
    .bind(entity, entityId)
    .all<AuditRow>();
  return c.json<AuditEntry[]>(
    results.map((r) => ({
      id: r.id,
      entity: r.entity,
      entityId: r.entity_id,
      action: r.action,
      before: r.before ? JSON.parse(r.before) : null,
      after: r.after ? JSON.parse(r.after) : null,
      userName: r.user_name,
      createdAt: r.created_at,
    })),
  );
});
