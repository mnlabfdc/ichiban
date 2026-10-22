import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, "bad_request", message);
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // 落到下面的錯誤
  }
  throw badRequest("請求內容不是有效的 JSON");
}

interface IntOptions {
  min?: number;
  max?: number;
}

export function intField(body: Record<string, unknown>, key: string, label: string, opts: IntOptions = {}): number {
  const v = body[key];
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw badRequest(`${label}必須是整數`);
  if (opts.min !== undefined && v < opts.min) throw badRequest(`${label}不能小於 ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) throw badRequest(`${label}不能大於 ${opts.max}`);
  return v;
}

export function optionalIntField(
  body: Record<string, unknown>,
  key: string,
  label: string,
  opts: IntOptions = {},
): number | undefined {
  return body[key] === undefined || body[key] === null ? undefined : intField(body, key, label, opts);
}

export function stringField(body: Record<string, unknown>, key: string, label: string, maxLength = 200): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) throw badRequest(`請填寫${label}`);
  if (v.trim().length > maxLength) throw badRequest(`${label}太長`);
  return v.trim();
}

export function optionalStringField(
  body: Record<string, unknown>,
  key: string,
  label: string,
  maxLength = 200,
): string | undefined {
  return body[key] === undefined || body[key] === null ? undefined : stringField(body, key, label, maxLength);
}

export function isoField(body: Record<string, unknown>, key: string, label: string): string {
  const v = body[key];
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw badRequest(`${label}格式不對`);
  return new Date(v).toISOString();
}
