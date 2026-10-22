import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthUser, Role, UserDto } from "../shared/types";
import { newId, nowIso } from "./db";
import type { AppEnv, Env } from "./env";
import { badRequest, HttpError, readJson } from "./http";
import { burnPasswordCheck, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./passwords";

const COOKIE = "ichiban_session";
const DAY_MS = 86_400_000;
/** 連續這麼多天沒用才過期 */
const SESSION_DAYS = 90;
/** 同一個帳號連續輸錯這麼多次就鎖住 */
const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;

/** 店主帳號：帳密是 Worker secret（ADMIN_USERNAME／ADMIN_PASSWORD），固定是管理員 */
export const OWNER_ID = "owner";

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  password_hash: string | null;
  disabled_at: string | null;
  created_at: string;
}

export function toAuthUser(r: UserRow): AuthUser {
  return { id: r.id, username: r.username, displayName: r.display_name, role: r.role, isOwner: r.id === OWNER_ID };
}

export function toUserDto(r: UserRow): UserDto {
  return { ...toAuthUser(r), disabled: r.disabled_at !== null, createdAt: r.created_at };
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 先各自雜湊再逐位元比對，比對時間跟內容無關 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function writeCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function checkNewPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`密碼至少要 ${MIN_PASSWORD_LENGTH} 個字`);
  }
  if (password.length > 128) throw badRequest("密碼太長");
  return password;
}

/** 驗證帳密；錯了回傳 null。店主帳號比對 Worker secret，其他人比對資料庫裡的雜湊。 */
async function authenticate(env: Env, username: string, password: string): Promise<UserRow | null> {
  const db = env.DB;
  const ownerName = env.ADMIN_USERNAME?.trim();
  if (ownerName && username.toLowerCase() === ownerName.toLowerCase()) {
    if (!env.ADMIN_PASSWORD || !(await safeEqual(password, env.ADMIN_PASSWORD))) return null;
    // 第一次登入時建立店主帳號；secret 改了帳號名稱也跟著更新
    await db
      .prepare(
        `INSERT INTO users (id, username, display_name, role, password_hash, created_at)
         VALUES (?, ?, '店主', 'admin', NULL, ?)
         ON CONFLICT (id) DO UPDATE SET username = excluded.username, role = 'admin', disabled_at = NULL`,
      )
      .bind(OWNER_ID, ownerName, nowIso())
      .run();
    return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(OWNER_ID).first<UserRow>();
  }
  const row = await db
    .prepare(`SELECT * FROM users WHERE username = ? AND id != ?`)
    .bind(username, OWNER_ID)
    .first<UserRow>();
  if (!row?.password_hash) {
    await burnPasswordCheck(password);
    return null;
  }
  return (await verifyPassword(password, row.password_hash)) ? row : null;
}

/** 不需要登入的路由 */
export const publicAuthRoutes = new Hono<AppEnv>();

publicAuthRoutes.post("/login", async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) throw new HttpError(401, "bad_credentials", "帳號或密碼錯誤");

  const attempt = await db
    .prepare(`SELECT failures, locked_until FROM login_attempts WHERE username = ?`)
    .bind(username)
    .first<{ failures: number; locked_until: string | null }>();
  const lockedMs = attempt?.locked_until ? Date.parse(attempt.locked_until) - Date.now() : 0;
  if (lockedMs > 0) {
    throw new HttpError(429, "locked", `密碼錯太多次，請 ${Math.ceil(lockedMs / 60_000)} 分鐘後再試`);
  }

  const user = await authenticate(c.env, username, password);
  if (!user) {
    const failures = (attempt?.failures ?? 0) + 1;
    const lock = failures >= MAX_FAILURES;
    await db
      .prepare(
        `INSERT INTO login_attempts (username, failures, locked_until) VALUES (?, ?, ?)
         ON CONFLICT (username) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until`,
      )
      .bind(username, lock ? 0 : failures, lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null)
      .run();
    throw new HttpError(401, "bad_credentials", "帳號或密碼錯誤");
  }
  if (user.disabled_at) throw new HttpError(403, "disabled", "這個帳號已停用，請找管理員");

  const token = newToken();
  const now = nowIso();
  await db.batch([
    db.prepare(`DELETE FROM login_attempts WHERE username = ?`).bind(username),
    db
      .prepare(`INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(newId(), toHex(await sha256(token)), user.id, now, now),
  ]);
  writeCookie(c, token);
  return c.json({ user: toAuthUser(user) });
});

publicAuthRoutes.post("/logout", async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
      .bind(toHex(await sha256(token)))
      .run();
  }
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) throw new HttpError(401, "unauthorized", "請先登入");
  const db = c.env.DB;
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.last_seen_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .bind(toHex(await sha256(token)))
    .first<UserRow & { session_id: string; last_seen_at: string }>();
  if (!row || row.disabled_at) throw new HttpError(401, "unauthorized", "請先登入");

  const idle = Date.now() - Date.parse(row.last_seen_at);
  if (idle > SESSION_DAYS * DAY_MS) {
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(row.session_id).run();
    throw new HttpError(401, "unauthorized", "登入已過期，請重新登入");
  }
  // 最後使用時間一天最多更新一次，順便延長 cookie
  if (idle > DAY_MS) {
    await db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).bind(nowIso(), row.session_id).run();
    writeCookie(c, token);
  }
  c.set("sessionId", row.session_id);
  c.set("user", toAuthUser(row));
  await next();
};

/** 接在 requireAuth 後面：只有管理員可以用 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user").role !== "admin") throw new HttpError(403, "forbidden", "只有管理員可以使用這個功能");
  await next();
};

/** 需要登入的帳號路由 */
export const accountRoutes = new Hono<AppEnv>();

accountRoutes.get("/me", (c) => c.json({ user: c.get("user") }));

/** 改自己的密碼；其他電腦上的登入會被登出 */
accountRoutes.post("/me/password", async (c) => {
  const user = c.get("user");
  if (user.isOwner) throw badRequest("店主帳號的密碼要用 wrangler secret put ADMIN_PASSWORD 修改");
  const body = await readJson(c);
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = checkNewPassword(body.newPassword);
  const db = c.env.DB;
  const row = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(user.id).first<UserRow>();
  if (!row?.password_hash || !(await verifyPassword(current, row.password_hash))) {
    throw new HttpError(400, "bad_password", "目前的密碼不對");
  }
  await db.batch([
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(await hashPassword(next), user.id),
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`).bind(user.id, c.get("sessionId")),
  ]);
  return c.json({ ok: true });
});

accountRoutes.post("/logout-all", requireAdmin, async (c) => {
  await c.env.DB.prepare(`DELETE FROM sessions`).run();
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});
