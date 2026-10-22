import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { formatMoney } from "../../shared/calc";

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="error-text" role="alert">
      {children}
    </p>
  );
}

/** 成本；工作人員開的新款還沒補成本時標示「待補成本」 */
export function CostCell({ cost }: { cost: number | null }) {
  return cost === null ? <span className="tag tag-warn">待補成本</span> : <>{formatMoney(cost)}</>;
}

/** 利潤；成本待補時算不出來 */
export function ProfitCell({ profit }: { profit: number | null }) {
  if (profit === null) return <span className="muted">—</span>;
  return <span className={profit < 0 ? "tone-bad" : "tone-good"}>{formatMoney(profit)}</span>;
}

/** 表單輸入的整數；空字串或格式不對回傳 null */
export function toInt(s: string): number | null {
  const t = s.trim().replaceAll(",", "");
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}
