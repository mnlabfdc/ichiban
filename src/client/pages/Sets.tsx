import { useState, type FormEvent } from "react";
import { formatMoney } from "../../shared/calc";
import { formatTaipei } from "../../shared/time";
import { STATUS_LABEL, type SetDto } from "../../shared/types";
import { api, errorMessage } from "../api";
import { AuditHistory } from "../components/AuditHistory";
import { OpenSetModal } from "../components/OpenSetModal";
import { CostCell, ErrorText, Field, Modal, toInt } from "../components/ui";
import { useApp } from "../context";
import { useApi } from "../hooks";

type Dialog =
  | { kind: "open" }
  | { kind: "edit"; set: SetDto }
  | { kind: "transfer"; set: SetDto }
  | { kind: "history"; set: SetDto };

type StatusFilter = "selling" | "sold_out" | "missing_cost" | "";

export function SetsPage() {
  const { branches } = useApp();
  const [status, setStatus] = useState<StatusFilter>("selling");
  const [branch, setBranch] = useState("");
  const [q, setQ] = useState("");
  const params = new URLSearchParams();
  if (status === "missing_cost") params.set("missingCost", "1");
  else if (status) params.set("status", status);
  if (branch) params.set("branchId", branch);
  if (q.trim()) params.set("q", q.trim());
  const { data, error, reload } = useApi<SetDto[]>(`/sets?${params}`);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const done = () => {
    setDialog(null);
    void reload();
  };

  const remove = async (set: SetDto) => {
    if (!window.confirm(`確定刪除「${set.name}」？`)) return;
    try {
      await api(`/sets/${set.id}`, { method: "DELETE" });
      setActionError(null);
      void reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>套管理</h1>
        <button type="button" className="primary" onClick={() => setDialog({ kind: "open" })}>
          ＋ 開套
        </button>
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="狀態">
          <option value="selling">販售中</option>
          <option value="sold_out">完售</option>
          <option value="missing_cost">待補成本</option>
          <option value="">全部狀態</option>
        </select>
        <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="分店">
          <option value="">全部分店</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋品名或條碼" aria-label="搜尋" />
      </div>

      <ErrorText>{actionError ?? error}</ErrorText>
      {!data ? (
        <p className="muted">載入中…</p>
      ) : data.length === 0 ? (
        <p className="muted">沒有符合的套</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>品名</th>
              <th>條碼</th>
              <th>分店</th>
              <th className="num">每抽</th>
              <th className="num">已賣／總抽數</th>
              <th className="num">成本</th>
              <th className="num">已收</th>
              <th>狀態</th>
              <th>開套時間</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="mono">{s.barcode}</td>
                <td>{s.branchName}</td>
                <td className="num">{formatMoney(s.pricePerDraw)}</td>
                <td className="num">
                  {s.soldDraws}／{s.totalDraws}
                </td>
                <td className="num">
                  <CostCell cost={s.cost} />
                </td>
                <td className="num">{formatMoney(s.revenue)}</td>
                <td>{STATUS_LABEL[s.status]}</td>
                <td>{formatTaipei(s.createdAt)}</td>
                <td className="actions">
                  <button type="button" className="link-button" onClick={() => setDialog({ kind: "edit", set: s })}>
                    編輯
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setDialog({ kind: "transfer", set: s })}
                  >
                    調貨
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setDialog({ kind: "history", set: s })}
                  >
                    紀錄
                  </button>
                  {!s.hasSales && (
                    <button type="button" className="link-button danger" onClick={() => void remove(s)}>
                      刪除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialog?.kind === "open" && <OpenSetModal onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "edit" && <EditSetModal set={dialog.set} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "transfer" && (
        <TransferModal set={dialog.set} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "history" && (
        <Modal title={`修改紀錄：${dialog.set.name}`} onClose={() => setDialog(null)} wide>
          <AuditHistory entity="set" entityId={dialog.set.id} />
        </Modal>
      )}
    </div>
  );
}

function EditSetModal({ set, onClose, onSaved }: { set: SetDto; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: set.name,
    cost: set.cost === null ? "" : String(set.cost),
    pricePerDraw: String(set.pricePerDraw),
    totalDraws: String(set.totalDraws),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // 待補成本的套可以先不填，維持待補
    const costEmpty = form.cost.trim() === "" && set.cost === null;
    const cost = costEmpty ? null : toInt(form.cost);
    const pricePerDraw = toInt(form.pricePerDraw);
    const totalDraws = toInt(form.totalDraws);
    if (!form.name.trim()) return setError("請填品名");
    if (!costEmpty && (cost === null || cost < 0)) return setError("成本要是 0 以上的整數");
    if (pricePerDraw === null || pricePerDraw < 1) return setError("每抽價格要是 1 以上的整數");
    if (totalDraws === null || totalDraws < 1) return setError("總抽數要是 1 以上的整數");
    setBusy(true);
    try {
      await api(`/sets/${set.id}`, {
        method: "PATCH",
        body: { name: form.name.trim(), ...(cost === null ? {} : { cost }), pricePerDraw, totalDraws },
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`編輯：${set.name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="品名">
          <input value={form.name} onChange={(e) => update("name")(e.target.value)} autoFocus />
        </Field>
        <Field label="成本" hint={set.cost === null ? "工作人員開的新款，補上成本才算得出回本" : undefined}>
          <input inputMode="numeric" value={form.cost} onChange={(e) => update("cost")(e.target.value)} />
        </Field>
        <Field label="每抽價格" hint="之後的銷售用新價格；已記的銷售金額不變">
          <input
            inputMode="numeric"
            value={form.pricePerDraw}
            onChange={(e) => update("pricePerDraw")(e.target.value)}
          />
        </Field>
        <Field label="總抽數" hint={`不能小於已賣抽數（${set.soldDraws}）`}>
          <input inputMode="numeric" value={form.totalDraws} onChange={(e) => update("totalDraws")(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="button-row">
          <button type="submit" className="primary" disabled={busy}>
            儲存
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TransferModal({ set, onClose, onSaved }: { set: SetDto; onClose: () => void; onSaved: () => void }) {
  const { branches } = useApp();
  const others = branches.filter((b) => b.id !== set.branchId);
  const [target, setTarget] = useState(String(others[0]?.id ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/sets/${set.id}/transfer`, { body: { branchId: Number(target) } });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`調貨：${set.name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted">
          目前在 {set.branchName}，已賣 {set.soldDraws}／{set.totalDraws} 抽會跟著帶過去。之前的銷售仍算在原本賣出的分店。
        </p>
        <Field label="調到">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {others.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="button-row">
          <button type="submit" className="primary" disabled={busy || !target}>
            調貨
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  );
}
