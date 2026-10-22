import { formatMoney } from "../../shared/calc";
import { formatTaipei } from "../../shared/time";
import { SALE_TYPE_LABEL, type AuditEntry, type SaleType } from "../../shared/types";
import { useApi } from "../hooks";
import { ErrorText } from "./ui";

const ACTION_LABEL: Record<AuditEntry["action"], string> = {
  create: "建立",
  update: "修改",
  revoke: "撤銷",
  delete: "刪除",
  transfer: "調貨",
};

const FIELD_LABEL: Record<string, string> = {
  barcode: "條碼",
  name: "品名",
  branchName: "分店",
  cost: "成本",
  pricePerDraw: "每抽價格",
  totalDraws: "總抽數",
  openingDraws: "期初已賣抽數",
  openingRevenue: "期初已收金額",
  setName: "套",
  quantity: "抽數",
  amount: "實收金額",
  type: "類型",
  soldAt: "實際賣出時間",
  revokedAt: "撤銷時間",
};

const MONEY = new Set(["cost", "pricePerDraw", "openingRevenue", "amount"]);
const TIME = new Set(["soldAt", "revokedAt"]);

function show(key: string, value: unknown): string {
  if (key === "cost" && value === null) return "待補";
  if (value === null || value === undefined || value === "") return "—";
  if (MONEY.has(key) && typeof value === "number") return formatMoney(value);
  if (TIME.has(key) && typeof value === "string") return formatTaipei(value);
  if (key === "type" && typeof value === "string") return SALE_TYPE_LABEL[value as SaleType] ?? value;
  return String(value);
}

function changes(entry: AuditEntry): { key: string; from?: string; to?: string }[] {
  const keys = Object.keys(FIELD_LABEL).filter((k) => k in (entry.before ?? {}) || k in (entry.after ?? {}));
  if (entry.action === "update" || entry.action === "transfer") {
    return keys
      .filter((k) => JSON.stringify(entry.before?.[k]) !== JSON.stringify(entry.after?.[k]))
      .map((k) => ({ key: k, from: show(k, entry.before?.[k]), to: show(k, entry.after?.[k]) }));
  }
  const snapshot = entry.action === "delete" ? entry.before : entry.after;
  return keys
    .filter((k) => k !== "revokedAt" || entry.action === "revoke")
    .map((k) => ({ key: k, to: show(k, snapshot?.[k]) }));
}

export function AuditHistory({ entity, entityId }: { entity: "sale" | "set"; entityId: string }) {
  const { data, error } = useApi<AuditEntry[]>(`/audit?entity=${entity}&entityId=${encodeURIComponent(entityId)}`);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <p className="muted">載入中…</p>;
  if (data.length === 0) return <p className="muted">沒有修改紀錄</p>;
  return (
    <ol className="audit-list">
      {data.map((entry) => (
        <li key={entry.id}>
          <div className="audit-head">
            <strong>{ACTION_LABEL[entry.action]}</strong>
            <span className="muted">{formatTaipei(entry.createdAt)}</span>
            {entry.userName && <span className="tag">{entry.userName}</span>}
          </div>
          <ul className="audit-changes">
            {changes(entry).map((c) => (
              <li key={c.key}>
                <span className="muted">{FIELD_LABEL[c.key]}：</span>
                {c.from !== undefined ? (
                  <>
                    <del>{c.from}</del> → <ins>{c.to}</ins>
                  </>
                ) : (
                  c.to
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
