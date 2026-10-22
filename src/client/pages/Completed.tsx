import { formatMoney, profitOf } from "../../shared/calc";
import { formatTaipei } from "../../shared/time";
import type { SetDto } from "../../shared/types";
import { CostCell, ErrorText, ProfitCell } from "../components/ui";
import { useApi } from "../hooks";

export function CompletedPage() {
  const { data, error } = useApi<SetDto[]>("/completed");
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <p className="muted">載入中…</p>;
  return (
    <div>
      <div className="page-head">
        <h1>已完售</h1>
      </div>
      {data.length === 0 ? (
        <p className="muted">還沒有完售的套</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>品名</th>
              <th>分店</th>
              <th className="num">成本</th>
              <th className="num">實收合計</th>
              <th className="num">最終利潤</th>
              <th>完售時間</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
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
    </div>
  );
}
