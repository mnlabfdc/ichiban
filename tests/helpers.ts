import { readdirSync, readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import type { Env } from "../src/worker/env";
import app from "../src/worker/index";

export interface TestContext {
  env: Env;
  dispose: () => Promise<void>;
}

/** 用 wrangler 的本機 D1（記憶體、不落地）跑真的 migrations */
export async function startDb(): Promise<TestContext> {
  const proxy = await getPlatformProxy<Env>({ configPath: "wrangler.jsonc", persist: false });
  const db = proxy.env.DB;
  for (const file of readdirSync("migrations").sort()) {
    const statements = readFileSync(`migrations/${file}`, "utf8")
      .replace(/--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
  }
  return {
    env: { DB: db, ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-password" },
    dispose: proxy.dispose,
  };
}

export async function resetDb(db: D1Database) {
  await db.batch([
    db.prepare("DELETE FROM audit_log"),
    db.prepare("DELETE FROM sales"),
    db.prepare("DELETE FROM sets"),
    db.prepare("DELETE FROM sessions"),
    db.prepare("DELETE FROM login_attempts"),
    db.prepare("DELETE FROM users"),
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'data_version'"),
  ]);
}

export interface Res<T = any> {
  status: number;
  body: T;
}

/** 帶著 cookie 打 API 的小客戶端，像一台瀏覽器 */
export class Client {
  cookie = "";

  constructor(private env: Env) {}

  async req<T = any>(method: string, path: string, body?: unknown): Promise<Res<T>> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cookie) headers.cookie = this.cookie;
    const res = await app.fetch(
      new Request(`http://localhost/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      this.env,
    );
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0].endsWith("=") ? "" : setCookie.split(";")[0];
    return { status: res.status, body: (await res.json()) as T };
  }

  get<T = any>(path: string) {
    return this.req<T>("GET", path);
  }
  post<T = any>(path: string, body: unknown = {}) {
    return this.req<T>("POST", path, body);
  }
  patch<T = any>(path: string, body: unknown) {
    return this.req<T>("PATCH", path, body);
  }
  delete<T = any>(path: string) {
    return this.req<T>("DELETE", path);
  }

  /** 預設用店主帳號登入 */
  async login(username = "admin", password = "test-password") {
    const res = await this.post("/login", { username, password });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
    return this;
  }
}

/** 用管理員建立一個帳號，回傳已登入的客戶端 */
export async function createUser(
  admin: Client,
  env: Env,
  opts: { username: string; role: "admin" | "staff"; displayName?: string; password?: string },
): Promise<{ client: Client; id: string }> {
  const password = opts.password ?? "staff-password-1";
  const res = await admin.post("/users", {
    username: opts.username,
    displayName: opts.displayName ?? opts.username,
    role: opts.role,
    password,
  });
  if (res.status !== 201) throw new Error(`create user failed: ${JSON.stringify(res.body)}`);
  const client = await new Client(env).login(opts.username, password);
  return { client, id: res.body.id };
}

let counter = 0;
export function clientId(): string {
  counter += 1;
  return `test-${Date.now()}-${counter}`;
}
