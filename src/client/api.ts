import type { ApiErrorBody } from "../shared/types";

/** 伺服器有回應、但回的是錯誤 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: ApiErrorBody | null,
  ) {
    super(message);
  }
}

/** 根本連不到伺服器（斷線） */
export class NetworkError extends Error {
  constructor() {
    super("連不到伺服器");
  }
}

const unauthorizedListeners = new Set<() => void>();

export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

interface Options {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
    });
  } catch {
    throw new NetworkError();
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 回應
  }
  if (!res.ok) {
    const body = data as ApiErrorBody | null;
    if (res.status === 401 && path !== "/login") unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(res.status, body?.code ?? "error", body?.error ?? `伺服器錯誤（${res.status}）`, body);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}
