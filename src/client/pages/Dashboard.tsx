import { useState } from "react";
import { formatMoney, progressOf } from "../../shared/calc";
import { hasCostInfo, type DashboardResponse, type PublicSetDto, type SetDto } from "../../shared/types";
import { ErrorText } from "../components/ui";
import { SetBar } from "../components/SetBar";
import { useApp } from "../context";
import { useApi, useVersionPolling } from "../hooks";
import { readLocal, writeLocal } from "../storage";

type SortKey = "progress" | "created" | "name" | "remaining";

const SORT_LABEL: Record<SortKey, string> = {
  progress: "回本進度",
  created: "開套時間",
  name: "品名",
  remaining: "剩餘抽數",
};

/** 工作人員沒有成本資料，不能依回本進度排（排序本身就會透露成本的高低） */
const ADMIN_SORTS: SortKey[] = ["progress", "created", "name"];
const STAFF_SORTS: SortKey[] = ["created", "name", "remaining"];
const SORT_STORAGE = "ichiban.dashboardSort";

/** 回本進度：待補成本的最前面，再來是還沒回本、離回本越遠越前面，已回本的依利潤由少到多 */
function progressRank(a: SetDto, b: SetDto): number {
  const pa = progressOf(a);
  const pb = progressOf(b);
  if (pa.costMissing !== pb.costMissing) return pa.costMissing ? -1 : 1;
  if (pa.costMissing) return 0;
  if (pa.paidBack !== pb.paidBack) return pa.paidBack ? 1 : -1;
  if (!pa.paidBack) return pb.moneyToGo - pa.moneyToGo || pb.drawsToGo - pa.drawsToGo;
  return (pa.profit ?? 0) - (pb.profit ?? 0);
}

function sortSets(sets: (SetDto | PublicSetDto)[], key: SortKey): (SetDto | PublicSetDto)[] {
  const list = [...sets];
  switch (key) {
    case "name":
      return list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    case "created":
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "remaining":
      return list.sort((a, b) => a.totalDraws - a.soldDraws - (b.totalDraws - b.soldDraws));
    case "progress":
      return list.sort((a, b) => (hasCostInfo(a) && hasCostInfo(b) ? progressRank(a, b) : 0));
  }
}

export function DashboardPage() {
  const { isAdmin } = useApp();
  const { data, error, reload } = useApi<DashboardResponse>("/dashboard");
  useVersionPolling(data?.version, () => void reload());
  const [tab, setTab] = useState<number | "all">("all");
  const allowedSorts = isAdmin ? ADMIN_SORTS : STAFF_SORTS;
  const [sort, setSort] = useState<SortKey>(() => {
    const saved = readLocal(SORT_STORAGE) as SortKey | null;
    return saved && allowedSorts.includes(saved) ? saved : allowedSorts[0];
  });

  if (error && !data) return <ErrorText>{error}</ErrorText>;
  if (!data) return <p className="muted">載入中…</p>;

  const scoped = tab === "all" ? data.sets : data.sets.filter((s) => s.branchId === tab);
  const sets = sortSets(scoped, sort);
  const withCost = scoped.filter(hasCostInfo);
  const revenue = withCost.reduce((sum, s) => sum + s.revenue, 0);
  const toGo = withCost.reduce((sum, s) => sum + progressOf(s).moneyToGo, 0);
  const missingCost = withCost.filter((s) => s.cost === null).length;

  const changeSort = (key: SortKey) => {
    setSort(key);
    writeLocal(SORT_STORAGE, key);
  };

  return (
    <div>
      <div className="page-head">
        <h1>看板</h1>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
            總覽
          </button>
          {data.branches.map((b) => (
            <button key={b.id} type="button" role="tab" aria-selected={tab === b.id} onClick={() => setTab(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      </div>

      <div className={`stats${isAdmin ? "" : " stats-single"}`}>
        <div className="stat">
          <div className="stat-label">販售中</div>
          <div className="stat-value">{scoped.length} 套</div>
        </div>
        {isAdmin && (
          <>
            <div className="stat">
              <div className="stat-label">販售中各套已收金額合計</div>
              <div className="stat-value">{formatMoney(revenue)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">尚未回本金額合計</div>
              <div className="stat-value">{formatMoney(toGo)}</div>
              {missingCost > 0 && <div className="stat-note">另有 {missingCost} 套待補成本，沒算進來</div>}
            </div>
          </>
        )}
      </div>

      <div className="toolbar">
        <span className="muted">排序：</span>
        {allowedSorts.map((key) => (
          <button
            key={key}
            type="button"
            className={`chip${sort === key ? " active" : ""}`}
            aria-pressed={sort === key}
            onClick={() => changeSort(key)}
          >
            {SORT_LABEL[key]}
          </button>
        ))}
        {error && <span className="error-text">更新失敗：{error}</span>}
      </div>

      {sets.length === 0 ? (
        <p className="muted">沒有販售中的套</p>
      ) : (
        <div className="bars">
          {sets.map((s) => (
            <SetBar key={s.id} set={s} showBranch={tab === "all"} />
          ))}
        </div>
      )}
      <p className="legend muted">
        {isAdmin && (
          <>
            <span className="legend-line" /> 回本線 ·{" "}
          </>
        )}
        有人刷條碼或修改資料時，幾秒內自動更新
      </p>
    </div>
  );
}
