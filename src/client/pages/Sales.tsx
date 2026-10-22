import { useState, type FormEvent } from "react";
import { formatMoney } from "../../shared/calc";
import { formatTaipei, isoToTaipeiLocalInput, taipeiDate, taipeiLocalInputToIso } from "../../shared/time";
import { SALE_TYPE_LABEL, type SaleDto, type SetDto } from "../../shared/types";
import { api, ApiError, errorMessage, newClientId } from "../api";
import { AuditHistory } from "../components/AuditHistory";
import { ErrorText, Field, Modal, toInt } from "../components/ui";
import { useApp } from "../context";
import { useApi } from "../hooks";

type Dialog = { kind: "backfill" } | { kind: "edit"; sale: SaleDto } | { kind: "history"; sale: SaleDto };

/**
 * 送出補登或修改。超過總抽數時伺服器回 exceeds_confirm，問過使用者再帶 force 重送。
 * 回傳 false 代表使用者取消。
 */
async function saveWithConfirm(send: (force: boolean) => Promise<unknown>): Promise<boolean> {
  try {
    await send(false);
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.code === "exceeds_confirm") {
      if (!window.confirm(`${e.message}\n\n確定要存嗎？已賣抽數會超過總抽數。`)) return false;
      await send(true);
      return true;
    }
    throw e;
  }
}

export function SalesPage() {
  const { isAdmin } = useApp();
  return isAdmin ? <AdminSales /> : <StaffSales />;
}

/** 工作人員：本分店今天的銷售，唯讀，交班對帳用 */
function StaffSales() {
  const { branchId, branchName } = useApp();
  const { data, error, loading, reload } = useApi<SaleDto[]>(`/sales?branchId=${branchId}&includeRevoked=1`);
  const active = (data ?? []).filter((s) => !s.revokedAt);
  return (
    <div>
      <div className="page-head">
        <h1>今天的銷售 · {branchName}</h1>
        <button type="button" onClick={() => void reload()} disabled={loading}>
          重新整理
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
      {!data ? (
        <p className="muted">載入中…</p>
      ) : data.length === 0 ? (
        <p className="muted">今天還沒有銷售</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">今天實收（不含已撤銷）</div>
              <div className="stat-value">{formatMoney(active.reduce((n, s) => n + s.amount, 0))}</div>
            </div>
            <div className="stat">
              <div className="stat-label">賣出抽數</div>
              <div className="stat-value">{active.reduce((n, s) => n + s.quantity, 0)} 抽</div>
            </div>
            <div className="stat">
              <div className="stat-label">筆數</div>
              <div className="stat-value">{active.length} 筆</div>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>賣出時間</th>
                <th>套</th>
                <th>類型</th>
                <th className="num">抽數</th>
                <th className="num">實收</th>
                <th>登打人</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className={s.revokedAt ? "revoked" : undefined}>
                  <td>{formatTaipei(s.soldAt)}</td>
                  <td>{s.setName}</td>
                  <td>
                    {SALE_TYPE_LABEL[s.type]}
                    {s.revokedAt && <span className="tag tag-bad">已撤銷</span>}
                  </td>
                  <td className="num">{s.quantity}</td>
                  <td className="num">{formatMoney(s.amount)}</td>
                  <td>{s.createdByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function AdminSales() {
  const { branches } = useApp();
  const today = taipeiDate();
  const [filters, setFilters] = useState({ setId: "", branchId: "", from: today, to: today, includeRevoked: false });
  const params = new URLSearchParams();
  if (filters.setId) params.set("setId", filters.setId);
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.includeRevoked) params.set("includeRevoked", "1");
  const { data, error, reload } = useApi<SaleDto[]>(`/sales?${params}`);
  const { data: sets } = useApi<SetDto[]>("/sets");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const update = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));

  const revoke = async (sale: SaleDto) => {
    if (!window.confirm(`確定撤銷這筆？\n${sale.setName} ×${sale.quantity} ${formatMoney(sale.amount)}`)) return;
    try {
      await api(`/sales/${sale.id}/revoke`, { method: "POST" });
      setActionError(null);
      void reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const done = () => {
    setDialog(null);
    void reload();
  };

  const active = (data ?? []).filter((s) => !s.revokedAt);
  const totalDraws = active.reduce((n, s) => n + s.quantity, 0);
  const totalAmount = active.reduce((n, s) => n + s.amount, 0);

  return (
    <div>
      <div className="page-head">
        <h1>銷售紀錄</h1>
        <button type="button" className="primary" onClick={() => setDialog({ kind: "backfill" })}>
          ＋ 補登
        </button>
      </div>

      <div className="toolbar">
        <select value={filters.setId} onChange={(e) => update({ setId: e.target.value })} aria-label="套">
          <option value="">全部的套</option>
          {sets?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（{s.branchName}）
            </option>
          ))}
        </select>
        <select value={filters.branchId} onChange={(e) => update({ branchId: e.target.value })} aria-label="分店">
          <option value="">全部分店</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} aria-label="從" />
        <span className="muted">～</span>
        <input type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} aria-label="到" />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.includeRevoked}
            onChange={(e) => update({ includeRevoked: e.target.checked })}
          />
          顯示已撤銷
        </label>
      </div>

      <ErrorText>{actionError ?? error}</ErrorText>
      {!data ? (
        <p className="muted">載入中…</p>
      ) : data.length === 0 ? (
        <p className="muted">這段期間沒有銷售</p>
      ) : (
        <>
          <p className="muted">
            {active.length} 筆、{totalDraws} 抽、{formatMoney(totalAmount)}（不含已撤銷）
            {data.length >= 1000 && " · 只顯示最近 1000 筆，請縮小篩選範圍"}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>賣出時間</th>
                <th>套</th>
                <th>分店</th>
                <th>類型</th>
                <th className="num">抽數</th>
                <th className="num">實收</th>
                <th>登打時間</th>
                <th>登打人</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className={s.revokedAt ? "revoked" : undefined}>
                  <td>{formatTaipei(s.soldAt)}</td>
                  <td>{s.setName}</td>
                  <td>{s.branchName}</td>
                  <td>
                    {SALE_TYPE_LABEL[s.type]}
                    {s.revokedAt && <span className="tag tag-bad">已撤銷</span>}
                  </td>
                  <td className="num">{s.quantity}</td>
                  <td className="num">{formatMoney(s.amount)}</td>
                  <td className="muted">{formatTaipei(s.createdAt)}</td>
                  <td>{s.createdByName ?? "—"}</td>
                  <td className="actions">
                    {!s.revokedAt && (
                      <>
                        <button type="button" className="link-button" onClick={() => setDialog({ kind: "edit", sale: s })}>
                          修改
                        </button>
                        <button type="button" className="link-button danger" onClick={() => void revoke(s)}>
                          撤銷
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setDialog({ kind: "history", sale: s })}
                    >
                      紀錄
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {dialog?.kind === "backfill" && (
        <BackfillModal sets={sets ?? []} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "edit" && <EditSaleModal sale={dialog.sale} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "history" && (
        <Modal title={`修改紀錄：${dialog.sale.setName}`} onClose={() => setDialog(null)} wide>
          <AuditHistory entity="sale" entityId={dialog.sale.id} />
        </Modal>
      )}
    </div>
  );
}

function BackfillModal({ sets, onClose, onSaved }: { sets: SetDto[]; onClose: () => void; onSaved: () => void }) {
  const { branches } = useApp();
  const [clientId] = useState(newClientId);
  const [form, setForm] = useState({
    setId: "",
    branchId: "",
    quantity: "1",
    amount: "",
    soldAt: isoToTaipeiLocalInput(new Date().toISOString()),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 實收金額沒手動改過時，跟著「抽數 × 目前每抽價格」自動算
  const [amountTouched, setAmountTouched] = useState(false);
  const update = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const picked = sets.find((s) => s.id === form.setId);

  const autoAmount = (setId: string, quantity: string, current: string) => {
    const s = sets.find((x) => x.id === setId);
    const qty = toInt(quantity);
    return !amountTouched && s && qty !== null && qty > 0 ? String(qty * s.pricePerDraw) : current;
  };

  const pickSet = (id: string) => {
    const s = sets.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      setId: id,
      branchId: s ? String(s.branchId) : "",
      amount: autoAmount(id, f.quantity, f.amount),
    }));
  };

  const changeQuantity = (quantity: string) =>
    setForm((f) => ({ ...f, quantity, amount: autoAmount(f.setId, quantity, f.amount) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const quantity = toInt(form.quantity);
    const amount = toInt(form.amount);
    const soldAt = taipeiLocalInputToIso(form.soldAt);
    if (!picked) return setError("請選擇套");
    if (quantity === null || quantity < 1) return setError("抽數要是 1 以上的整數");
    if (amount === null || amount < 0) return setError("實收金額要是 0 以上的整數");
    if (!soldAt) return setError("請填實際賣出時間");
    setBusy(true);
    try {
      const saved = await saveWithConfirm((force) =>
        api("/sales", {
          body: { clientId, setId: picked.id, branchId: Number(form.branchId), quantity, amount, soldAt, force },
        }),
      );
      if (saved) onSaved();
      else setBusy(false);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="補登銷售" onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="套">
            <select value={form.setId} onChange={(e) => pickSet(e.target.value)} autoFocus>
              <option value="">請選擇</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.branchName}，剩 {s.totalDraws - s.soldDraws} 抽）
                </option>
              ))}
            </select>
          </Field>
          <Field label="分店" hint="預設帶入這套目前所在的分店">
            <select value={form.branchId} onChange={(e) => update("branchId")(e.target.value)}>
              <option value="" disabled>
                請先選套
              </option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="抽數">
            <input inputMode="numeric" value={form.quantity} onChange={(e) => changeQuantity(e.target.value)} />
          </Field>
          <Field label="實收金額" hint={picked ? `目前每抽 ${formatMoney(picked.pricePerDraw)}` : undefined}>
            <input
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => {
                setAmountTouched(true);
                update("amount")(e.target.value);
              }}
            />
          </Field>
          <Field label="實際賣出時間">
            <input type="datetime-local" value={form.soldAt} onChange={(e) => update("soldAt")(e.target.value)} />
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="button-row">
          <button type="submit" className="primary" disabled={busy}>
            補登
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditSaleModal({ sale, onClose, onSaved }: { sale: SaleDto; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    quantity: String(sale.quantity),
    amount: String(sale.amount),
    soldAt: isoToTaipeiLocalInput(sale.soldAt),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const quantity = toInt(form.quantity);
    const amount = toInt(form.amount);
    const soldAtInput = taipeiLocalInputToIso(form.soldAt);
    if (quantity === null || quantity < 1) return setError("抽數要是 1 以上的整數");
    if (amount === null || amount < 0) return setError("實收金額要是 0 以上的整數");
    if (!soldAtInput) return setError("請填實際賣出時間");
    // 時間欄位只到分鐘：沒動過就保留原本的秒數
    const soldAt = form.soldAt === isoToTaipeiLocalInput(sale.soldAt) ? sale.soldAt : soldAtInput;
    setBusy(true);
    try {
      const saved = await saveWithConfirm((force) =>
        api(`/sales/${sale.id}`, { method: "PATCH", body: { quantity, amount, soldAt, force } }),
      );
      if (saved) onSaved();
      else setBusy(false);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`修改銷售：${sale.setName}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="抽數">
          <input inputMode="numeric" value={form.quantity} onChange={(e) => update("quantity")(e.target.value)} autoFocus />
        </Field>
        <Field label="實收金額">
          <input inputMode="numeric" value={form.amount} onChange={(e) => update("amount")(e.target.value)} />
        </Field>
        <Field label="實際賣出時間">
          <input type="datetime-local" value={form.soldAt} onChange={(e) => update("soldAt")(e.target.value)} />
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
