// localStorage 可能被擋（無痕視窗等），讀寫都包起來

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存不了就算了
  }
}

const BRANCH_KEY = "ichiban.branchId";

/** 這台電腦所屬的分店 */
export function readLocalBranchId(): number | null {
  const n = Number(readLocal(BRANCH_KEY));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function writeLocalBranchId(id: number) {
  writeLocal(BRANCH_KEY, String(id));
}
