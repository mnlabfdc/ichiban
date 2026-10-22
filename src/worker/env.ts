import type { AuthUser } from "../shared/types";

export interface Env {
  DB: D1Database;
  /** 店主帳號 */
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { sessionId: string; user: AuthUser };
};
