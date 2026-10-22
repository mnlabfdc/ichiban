import { Hono } from "hono";
import type { Role, UserDto } from "../../shared/types";
import { checkNewPassword, OWNER_ID, requireAdmin, toUserDto, type UserRow } from "../auth";
import { newId, nowIso } from "../db";
import type { AppEnv } from "../env";
import { badRequest, HttpError, readJson, stringField } from "../http";
import { hashPassword } from "../passwords";

/** 使用者管理，只有管理員能用。帳號不能刪除，只能停用（修改紀錄才查得到是誰做的）。 */
export const userRoutes = new Hono<AppEnv>();

userRoutes.use("/users", requireAdmin);
userRoutes.use("/users/*", requireAdmin);

const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

function roleField(value: unknown): Role {
  if (value !== "admin" && value !== "staff") throw badRequest("角色只能是管理員或工作人員");
  return value;
}

async function getUserRow(db: D1Database, id: string): Promise<UserRow> {
  const row = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
  if (!row) throw new HttpError(404, "user_not_found", "找不到這個帳號");
  return row;
}

userRoutes.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM users ORDER BY id = '${OWNER_ID}' DESC, role, created_at`,
  ).all<UserRow>();
  return c.json<UserDto[]>(results.map(toUserDto));
});

userRoutes.post("/users", async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  const username = stringField(body, "username", "登入帳號", 32);
  if (!USERNAME_RE.test(username)) throw badRequest("登入帳號只能用英文、數字和 . _ -，3 到 32 個字");
  if (username.toLowerCase() === c.env.ADMIN_USERNAME?.trim().toLowerCase()) {
    throw new HttpError(409, "username_taken", "這個登入帳號已經有人用了");
  }
  const displayName = stringField(body, "displayName", "名稱", 30);
  const role = roleField(body.role);
  const password = checkNewPassword(body.password);
  const exists = await db.prepare(`SELECT 1 FROM users WHERE username = ?`).bind(username).first();
  if (exists) throw new HttpError(409, "username_taken", "這個登入帳號已經有人用了");

  const id = newId();
  await db
    .prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, username, displayName, role, await hashPassword(password), nowIso())
    .run();
  return c.json(toUserDto(await getUserRow(db, id)), 201);
});

/** 改名稱、角色、停用／恢復。停用時那個人所有電腦都會登出。 */
userRoutes.patch("/users/:id", async (c) => {
  const db = c.env.DB;
  const target = await getUserRow(db, c.req.param("id"));
  if (target.id === OWNER_ID) throw new HttpError(403, "owner_locked", "店主帳號不能修改");
  const body = await readJson(c);
  const me = c.get("user");
  const role = body.role === undefined ? target.role : roleField(body.role);
  const disabled = body.disabled === undefined ? target.disabled_at !== null : body.disabled === true;
  if (target.id === me.id && (role !== target.role || disabled)) {
    throw badRequest("不能停用自己，也不能改自己的角色");
  }
  const displayName =
    body.displayName === undefined ? target.display_name : stringField(body, "displayName", "名稱", 30);
  const disabledAt = disabled ? (target.disabled_at ?? nowIso()) : null;

  const statements = [
    db
      .prepare(`UPDATE users SET display_name = ?, role = ?, disabled_at = ? WHERE id = ?`)
      .bind(displayName, role, disabledAt, target.id),
  ];
  if (disabled) statements.push(db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(target.id));
  await db.batch(statements);
  return c.json(toUserDto(await getUserRow(db, target.id)));
});

/** 管理員重設別人的密碼；那個人所有電腦都會登出 */
userRoutes.post("/users/:id/password", async (c) => {
  const db = c.env.DB;
  const target = await getUserRow(db, c.req.param("id"));
  if (target.id === OWNER_ID) throw new HttpError(403, "owner_locked", "店主帳號的密碼要用 wrangler secret 修改");
  const body = await readJson(c);
  const password = checkNewPassword(body.password);
  await db.batch([
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(await hashPassword(password), target.id),
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(target.id),
  ]);
  return c.json({ ok: true });
});
