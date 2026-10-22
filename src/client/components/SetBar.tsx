import { formatMoney, progressOf } from "../../shared/calc";
import { hasCostInfo, type PublicSetDto, type SetDto } from "../../shared/types";

function pct(n: number, total: number): string {
  return `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
}

/**
 * 一套一條：全長是總抽數，填色是已賣抽數，直線是回本線。
 * 工作人員拿到的資料沒有成本，只畫抽數、不畫回本線。
 */
export function SetBar({ set, showBranch }: { set: SetDto | PublicSetDto; showBranch: boolean }) {
  let tone: "good" | "bad" | "pending" | "plain" = "plain";
  let status = `剩 ${set.totalDraws - set.soldDraws} 抽`;
  let breakeven: number | null = null;
  if (hasCostInfo(set)) {
    const p = progressOf(set);
    breakeven = p.breakevenPosition;
    if (p.costMissing) {
      tone = "plain";
      status = "待補成本，算不出回本";
    } else if (p.paidBack) {
      tone = "good";
      status = `已回本，目前利潤 ${formatMoney(p.profit ?? 0)}`;
    } else if (p.cannotBreakEven) {
      tone = "bad";
      status = `全賣完仍無法回本（還差 ${formatMoney(p.moneyToGo)}）`;
    } else {
      tone = "pending";
      status = `還差 ${p.drawsToGo} 抽、${formatMoney(p.moneyToGo)} 回本`;
    }
  }
  return (
    <div className="bar-row">
      <div className="bar-label">
        <span className="bar-name">{set.name}</span>
        {showBranch && <span className="tag">{set.branchName}</span>}
        {hasCostInfo(set) && set.cost === null && <span className="tag tag-warn">待補成本</span>}
        <span className="bar-count">
          {set.soldDraws}／{set.totalDraws}
        </span>
        <span className={`bar-status tone-${tone}`}>{status}</span>
      </div>
      <div
        className="bar"
        role="img"
        aria-label={`${set.name}：已賣 ${set.soldDraws}／${set.totalDraws} 抽，${status}`}
      >
        <div className={`bar-fill tone-${tone}`} style={{ width: pct(set.soldDraws, set.totalDraws) }} />
        {breakeven !== null && (
          <div
            className="bar-breakeven"
            style={{ left: pct(breakeven, set.totalDraws) }}
            title={`回本線：第 ${breakeven} 抽`}
          />
        )}
      </div>
    </div>
  );
}
