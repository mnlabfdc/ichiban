import { describe, expect, it } from "vitest";
import { parseScanInput, progressOf } from "../src/shared/calc";
import {
  addDays,
  formatTaipei,
  isoToTaipeiLocalInput,
  monthRange,
  taipeiDate,
  taipeiDayStartIso,
  taipeiLocalInputToIso,
} from "../src/shared/time";

const base = { cost: 1000, pricePerDraw: 100, totalDraws: 20, soldDraws: 4, revenue: 400, breakevenDraws: null };

describe("progressOf", () => {
  it("還沒回本：還差多少錢、幾抽、回本線位置", () => {
    expect(progressOf(base)).toMatchObject({
      remainingDraws: 16,
      moneyToGo: 600,
      drawsToGo: 6,
      paidBack: false,
      breakevenPosition: 10,
      cannotBreakEven: false,
      profit: -600,
    });
  });

  it("還差幾抽用目前每抽價格、無條件進位", () => {
    expect(progressOf({ ...base, pricePerDraw: 70 }).drawsToGo).toBe(9);
  });

  it("全賣完仍無法回本", () => {
    const p = progressOf({ ...base, pricePerDraw: 30 });
    expect(p.cannotBreakEven).toBe(true);
    expect(p.breakevenPosition).toBeNull();
  });

  it("已回本：回本線用伺服器算好的位置，顯示利潤", () => {
    const p = progressOf({ ...base, soldDraws: 12, revenue: 1200, breakevenDraws: 10 });
    expect(p).toMatchObject({ paidBack: true, drawsToGo: 0, moneyToGo: 0, breakevenPosition: 10, profit: 200 });
  });

  it("賣超時剩餘抽數是負數", () => {
    expect(progressOf({ ...base, soldDraws: 22 }).remainingDraws).toBe(-2);
  });
});

describe("parseScanInput", () => {
  it("沒有數量時記 1 抽", () => {
    expect(parseScanInput("4710000000001")).toEqual({ quantity: 1, barcode: "4710000000001" });
  });
  it("數量＊條碼", () => {
    expect(parseScanInput("3*4710000000001")).toEqual({ quantity: 3, barcode: "4710000000001" });
    expect(parseScanInput("12＊ABC-1")).toEqual({ quantity: 12, barcode: "ABC-1" });
  });
  it("沒有條碼或數量是 0 時不處理", () => {
    expect(parseScanInput("3*")).toBeNull();
    expect(parseScanInput("  ")).toBeNull();
    expect(parseScanInput("0*123")).toBeNull();
  });
});

describe("台灣時間", () => {
  it("UTC 16:00 之後是台灣的隔天", () => {
    expect(taipeiDate("2026-10-20T15:59:59.000Z")).toBe("2026-10-20");
    expect(taipeiDate("2026-10-20T16:00:00.000Z")).toBe("2026-10-21");
  });
  it("台灣日期 00:00 換成 UTC", () => {
    expect(taipeiDayStartIso("2026-10-21")).toBe("2026-10-20T16:00:00.000Z");
  });
  it("月份範圍", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("datetime-local 與 ISO 互轉", () => {
    expect(taipeiLocalInputToIso("2026-10-21T08:30")).toBe("2026-10-21T00:30:00.000Z");
    expect(isoToTaipeiLocalInput("2026-10-21T00:30:00.000Z")).toBe("2026-10-21T08:30");
    expect(formatTaipei("2026-10-21T00:30:00.000Z")).toBe("2026/10/21 08:30");
    expect(taipeiLocalInputToIso("garbage")).toBeNull();
  });
});
