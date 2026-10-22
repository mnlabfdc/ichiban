// 密碼雜湊：PBKDF2-SHA256。
// 免費方案每次請求只有 10ms CPU，實測 1 萬次約 4ms，所以只能用 1 萬次；
// 迭代次數存在雜湊字串裡，之後要調高時舊密碼仍然驗得過。

const ITERATIONS = 10_000;
const PREFIX = "pbkdf2-sha256";
/** workerd 允許的上限 */
const MAX_ITERATIONS = 100_000;

export const MIN_PASSWORD_LENGTH = 8;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, iter, salt, hash] = stored.split("$");
  const iterations = Number(iter);
  if (prefix !== PREFIX || !Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    return false;
  }
  try {
    return sameBytes(await derive(password, fromBase64(salt), iterations), fromBase64(hash));
  } catch {
    return false;
  }
}

/** 帳號不存在時也算一次雜湊，回應時間才不會透露帳號存不存在 */
export async function burnPasswordCheck(password: string): Promise<void> {
  await derive(password, new Uint8Array(16), ITERATIONS);
}
