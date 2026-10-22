import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { PublicSetDto, SetDto, SetPrefill } from "../../shared/types";
import { api, errorMessage } from "../api";
import { useApp } from "../context";
import { ErrorText, Field, Modal, toInt } from "./ui";

/**
 * 開套。管理員填完整資料；工作人員不填成本和期初，分店固定是本機分店，
 * 成本由伺服器沿用同條碼最近一套的（新款就待補）。
 */
export function OpenSetModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (created: SetDto | PublicSetDto) => void;
}) {
  const { branches, branchId, branchName, isAdmin } = useApp();
  const [form, setForm] = useState({
    barcode: "",
    name: "",
    cost: "",
    pricePerDraw: "",
    totalDraws: "",
    branchId: String(branchId),
    openingDraws: "",
    openingRevenue: "",
  });
  /** 查過的條碼，以及這個條碼以前有沒有開過 */
  const [looked, setLooked] = useState<{ barcode: string; found: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const lookup = async () => {
    const barcode = form.barcode.trim();
    if (!barcode || looked?.barcode === barcode) return;
    try {
      const p = await api<SetPrefill | null>(`/sets/prefill?barcode=${encodeURIComponent(barcode)}`);
      setLooked({ barcode, found: p !== null });
      if (!p) return;
      setForm((f) => ({
        ...f,
        name: p.name,
        cost: p.cost === undefined || p.cost === null ? f.cost : String(p.cost),
        pricePerDraw: String(p.pricePerDraw),
        totalDraws: String(p.totalDraws),
      }));
    } catch {
      // 帶不到就自己填
    }
  };

  const onBarcodeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // 條碼槍刷完會按 Enter：查舊資料，不要送出表單
    if (e.key === "Enter") {
      e.preventDefault();
      void lookup();
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const pricePerDraw = toInt(form.pricePerDraw);
    const totalDraws = toInt(form.totalDraws);
    if (!form.barcode.trim() || !form.name.trim()) return setError("請填條碼和品名");
    if (pricePerDraw === null || pricePerDraw < 1) return setError("每抽價格要是 1 以上的整數");
    if (totalDraws === null || totalDraws < 1) return setError("總抽數要是 1 以上的整數");
    const body: Record<string, unknown> = {
      barcode: form.barcode.trim(),
      name: form.name.trim(),
      branchId: isAdmin ? Number(form.branchId) : branchId,
      pricePerDraw,
      totalDraws,
    };
    if (isAdmin) {
      const cost = toInt(form.cost);
      const openingDraws = form.openingDraws.trim() ? toInt(form.openingDraws) : 0;
      const openingRevenue = form.openingRevenue.trim() ? toInt(form.openingRevenue) : 0;
      if (cost === null || cost < 0) return setError("成本要是 0 以上的整數");
      if (openingDraws === null || openingDraws < 0 || openingDraws > totalDraws) {
        return setError("期初已賣抽數要在 0 到總抽數之間");
      }
      if (openingRevenue === null || openingRevenue < 0) return setError("期初已收金額要是 0 以上的整數");
      Object.assign(body, { cost, openingDraws, openingRevenue });
    }
    setBusy(true);
    try {
      onSaved(await api<SetDto | PublicSetDto>("/sets", { body }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const barcodeHint = !looked
    ? "刷條碼或手動輸入"
    : looked.found
      ? isAdmin
        ? "已帶入這個條碼最近一套的資料"
        : "已帶入這個條碼最近一套的資料，成本會沿用上一套"
      : isAdmin
        ? "新的條碼"
        : "新款：成本要請管理員之後補上";

  return (
    <Modal title="開套" onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="條碼" hint={barcodeHint}>
            <input
              value={form.barcode}
              onChange={(e) => set("barcode")(e.target.value)}
              onKeyDown={onBarcodeKey}
              onBlur={() => void lookup()}
              autoFocus
              autoComplete="off"
            />
          </Field>
          <Field label="品名">
            <input value={form.name} onChange={(e) => set("name")(e.target.value)} />
          </Field>
          {isAdmin && (
            <Field label="成本（整套進貨總價）">
              <input inputMode="numeric" value={form.cost} onChange={(e) => set("cost")(e.target.value)} />
            </Field>
          )}
          <Field label="每抽價格">
            <input
              inputMode="numeric"
              value={form.pricePerDraw}
              onChange={(e) => set("pricePerDraw")(e.target.value)}
            />
          </Field>
          <Field label="總抽數">
            <input inputMode="numeric" value={form.totalDraws} onChange={(e) => set("totalDraws")(e.target.value)} />
          </Field>
          <Field label="分店">
            {isAdmin ? (
              <select value={form.branchId} onChange={(e) => set("branchId")(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <input value={branchName} disabled />
            )}
          </Field>
          {isAdmin && (
            <>
              <Field label="期初已賣抽數（選填）" hint="上線前就賣掉的抽數，算進回本、不算進報表">
                <input
                  inputMode="numeric"
                  value={form.openingDraws}
                  onChange={(e) => set("openingDraws")(e.target.value)}
                />
              </Field>
              <Field label="期初已收金額（選填）">
                <input
                  inputMode="numeric"
                  value={form.openingRevenue}
                  onChange={(e) => set("openingRevenue")(e.target.value)}
                />
              </Field>
            </>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="button-row">
          <button type="submit" className="primary" disabled={busy}>
            開套
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  );
}
