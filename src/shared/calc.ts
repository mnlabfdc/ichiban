import type { SetDto } from "./types";

export interface Progress {
  remainingDraws: number;
  /** 成本待補：下面跟回本有關的數字都沒有意義 */
  costMissing: boolean;
  /** 還差多少錢回本 */
  moneyToGo: number;
  /** 還差幾抽回本（用目前每抽價格） */
  drawsToGo: number;
  paidBack: boolean;
  /** 已收金額 − 成本，還沒回本時是負數；成本待補時為 null */
  profit: number | null;
  /** 回本線落在第幾抽；全賣完也無法回本、或成本待補時為 null */
  breakevenPosition: number | null;
  cannotBreakEven: boolean;
}

type ProgressInput = Pick<
  SetDto,
  "cost" | "pricePerDraw" | "totalDraws" | "soldDraws" | "revenue" | "breakevenDraws"
>;

/** SPEC「計算」一節的公式。已賣抽數、已收金額、已回本的回本線由伺服器算好存在套上。 */
export function progressOf(set: ProgressInput): Progress {
  const remainingDraws = set.totalDraws - set.soldDraws;
  if (set.cost === null) {
    return {
      remainingDraws,
      costMissing: true,
      moneyToGo: 0,
      drawsToGo: 0,
      paidBack: false,
      profit: null,
      breakevenPosition: null,
      cannotBreakEven: false,
    };
  }
  const moneyToGo = Math.max(0, set.cost - set.revenue);
  const paidBack = moneyToGo === 0;
  const drawsToGo = paidBack
    ? 0
    : set.pricePerDraw > 0
      ? Math.ceil(moneyToGo / set.pricePerDraw)
      : Number.POSITIVE_INFINITY;
  const cannotBreakEven = !paidBack && drawsToGo > remainingDraws;
  const breakevenPosition = paidBack
    ? (set.breakevenDraws ?? set.soldDraws)
    : cannotBreakEven
      ? null
      : set.soldDraws + drawsToGo;
  return {
    remainingDraws,
    costMissing: false,
    moneyToGo,
    drawsToGo,
    paidBack,
    profit: set.revenue - set.cost,
    breakevenPosition,
    cannotBreakEven,
  };
}

/** 利潤 = 已收金額 − 成本；成本待補時為 null */
export function profitOf(set: Pick<SetDto, "cost" | "revenue">): number | null {
  return set.cost === null ? null : set.revenue - set.cost;
}

/**
 * 解析櫃檯輸入框：「3*4712345678901」= 3 抽，沒有「*」就是 1 抽。
 * 回傳 null 代表沒有條碼可以處理。
 */
export function parseScanInput(raw: string): { quantity: number; barcode: string } | null {
  const text = raw.trim();
  const match = /^(\d+)\s*[*＊]\s*(.*)$/.exec(text);
  const quantity = match ? Number.parseInt(match[1], 10) : 1;
  const barcode = (match ? match[2] : text).trim();
  if (!barcode || !Number.isSafeInteger(quantity) || quantity < 1) return null;
  return { quantity, barcode };
}

export function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US")}`;
}
