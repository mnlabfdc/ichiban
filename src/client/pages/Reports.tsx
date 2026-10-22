import { useState, type ReactNode } from "react";
import { formatMoney, profitOf } from "../../shared/calc";
import { formatTaipei, monthRange, taipeiDate } from "../../shared/time";
import type { ReportResponse } from "../../shared/types";
import { CostCell, ErrorText, ProfitCell } from "../components/ui";
import { downloadCsv } from "../csv";
import { useApi } from "../hooks";

type Mode = "day" | "month";

function Section({ title, onCsv, children }: { title: string; onCsv?: () => void; children: ReactNode }) {
  return (
    <section className="card report-section">
      <div className="section-head">
        <h2>{title}</h2>
        {onCsv && (
          <button type="button" className="small" onClick={onCsv}>
            匯出 CSV
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function ReportsPage() {
  const today = taipeiDate();
  const [mode, setMode] = useState<Mode>("day");
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const range = mode === "day" ? { from: day, to: day } : month ? monthRange(month) : null;
  const { data, error, loading } = useApi<ReportResponse>(
    range?.from ? `/reports?from=${range.from}&to=${range.to}` : null,
  );
  const label = mode === "day" ? day : month;

  return (
    <div>
      <div className="page-head">
        <h1>報表</h1>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "day"} onClick={() => setMode("day")}>
            每日
          </button>
          <button type="button" role="tab" aria-selected={mode === "month"} onClick={() => setMode("month")}>
            每月
          </button>
        </div>
        {mode === "day" ? (
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="日期" />
        ) : (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="月份" />
        )}
      </div>
      <p className="muted">依實際賣出時間、台灣時間午夜換日計算；不含期初資料和已撤銷的銷售。每筆算在刷條碼的那家分店。</p>

      <ErrorText>{error}</ErrorText>
      {!data || loading ? <p className="muted">載入中…</p> : <ReportBody data={data} mode={mode} label={label} />}
    </div>
  );
}

function ReportBody({ data, mode, label }: { data: ReportResponse; mode: Mode; label: string }) {
  const nameOf = (id: number) => data.branches.find((b) => b.id === id)?.name ?? `分店 ${id}`;
  const totalOf = (id: number) => data.totals.find((t) => t.branchId === id) ?? { revenue: 0, draws: 0 };
  const grandRevenue = data.totals.reduce((n, t) => n + t.revenue, 0);
  const grandDraws = data.totals.reduce((n, t) => n + t.draws, 0);
  const file = (part: string) => `一番賞報表-${label}-${part}.csv`;

  const dates = [...new Set(data.days.map((d) => d.date))].sort();
  const dayCell = (date: string, branchId: number) =>
    data.days.find((d) => d.date === date && d.branchId === branchId) ?? { revenue: 0, draws: 0 };

  return (
    <>
      <Section
        title="營收"
        onCsv={() =>
          downloadCsv(
            file("營收"),
            ["分店", "實收營收", "賣出抽數"],
            [
              ...data.branches.map((b) => [b.name, totalOf(b.id).revenue, totalOf(b.id).draws]),
              ["合計", grandRevenue, grandDraws],
            ],
          )
        }
      >
        <table className="table">
          <thead>
            <tr>
              <th>分店</th>
              <th className="num">實收營收</th>
              <th className="num">賣出抽數</th>
            </tr>
          </thead>
          <tbody>
            {data.branches.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td className="num">{formatMoney(totalOf(b.id).revenue)}</td>
                <td className="num">{totalOf(b.id).draws}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>合計</th>
              <th className="num">{formatMoney(grandRevenue)}</th>
              <th className="num">{grandDraws}</th>
            </tr>
          </tfoot>
        </table>
      </Section>

      {mode === "month" && (
        <Section
          title="每日營收"
          onCsv={() =>
            downloadCsv(
              file("每日營收"),
              ["日期", ...data.branches.map((b) => `${b.name}營收`), "合計營收", "合計抽數"],
              dates.map((date) => {
                const cells = data.branches.map((b) => dayCell(date, b.id));
                return [
                  date,
                  ...cells.map((c) => c.revenue),
                  cells.reduce((n, c) => n + c.revenue, 0),
                  cells.reduce((n, c) => n + c.draws, 0),
                ];
              }),
            )
          }
        >
          {dates.length === 0 ? (
            <p className="muted">這個月沒有銷售</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>日期</th>
                  {data.branches.map((b) => (
                    <th key={b.id} className="num">
                      {b.name}
                    </th>
                  ))}
                  <th className="num">合計</th>
                  <th className="num">抽數</th>
                </tr>
              </thead>
              <tbody>
                {dates.map((date) => {
                  const cells = data.branches.map((b) => dayCell(date, b.id));
                  return (
                    <tr key={date}>
                      <td>{date}</td>
                      {cells.map((c, i) => (
                        <td key={data.branches[i].id} className="num">
                          {formatMoney(c.revenue)}
                        </td>
                      ))}
                      <td className="num">{formatMoney(cells.reduce((n, c) => n + c.revenue, 0))}</td>
                      <td className="num">{cells.reduce((n, c) => n + c.draws, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>
      )}

      <Section
        title="期間內完售的套"
        onCsv={() =>
          downloadCsv(
            file("完售"),
            ["品名", "分店", "成本", "實收合計（含期初）", "利潤", "完售時間"],
            data.completed.map((s) => [
              s.name,
              s.branchName,
              s.cost ?? "待補成本",
              s.revenue,
              profitOf(s) ?? "待補成本",
              formatTaipei(s.completedAt),
            ]),
          )
        }
      >
        {data.completed.length === 0 ? (
          <p className="muted">這段期間沒有完售的套</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>品名</th>
                <th>分店</th>
                <th className="num">成本</th>
                <th className="num">實收合計（含期初）</th>
                <th className="num">利潤</th>
                <th>完售時間</th>
              </tr>
            </thead>
            <tbody>
              {data.completed.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.branchName}</td>
                  <td className="num">
                    <CostCell cost={s.cost} />
                  </td>
                  <td className="num">{formatMoney(s.revenue)}</td>
                  <td className="num">
                    <ProfitCell profit={profitOf(s)} />
                  </td>
                  <td>{formatTaipei(s.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="各套銷售明細"
        onCsv={() =>
          downloadCsv(
            file("各套明細"),
            ["品名", "分店", "抽數", "實收金額"],
            data.perSet.map((p) => [p.setName, nameOf(p.branchId), p.draws, p.revenue]),
          )
        }
      >
        {data.perSet.length === 0 ? (
          <p className="muted">這段期間沒有銷售</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>品名</th>
                <th>分店</th>
                <th className="num">抽數</th>
                <th className="num">實收金額</th>
              </tr>
            </thead>
            <tbody>
              {data.perSet.map((p) => (
                <tr key={`${p.setId}-${p.branchId}`}>
                  <td>{p.setName}</td>
                  <td>{nameOf(p.branchId)}</td>
                  <td className="num">{p.draws}</td>
                  <td className="num">{formatMoney(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
