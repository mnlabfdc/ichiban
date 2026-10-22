import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { formatMoney, parseScanInput } from "../../shared/calc";
import type { CounterSale, PublicSetDto, SaleDto, ScanResponse } from "../../shared/types";
import { api, ApiError, errorMessage, NetworkError, newClientId } from "../api";
import { OpenSetModal } from "../components/OpenSetModal";
import { ErrorText, Field, Modal, toInt } from "../components/ui";
import { useApp } from "../context";
import { beep } from "../sound";

type JobState = "queued" | "sending" | "choose" | "done" | "failed" | "unsent" | "checking";

/** 一次刷條碼（或包套）就是一個 job，依序排隊送出 */
interface Job {
  key: string; // 也是送給伺服器的 clientId
  label: string;
  barcode?: string;
  setId?: string;
  quantity: number;
  type: "normal" | "package";
  amount?: number;
  state: JobState;
  message?: string;
  candidates?: PublicSetDto[];
}

const STATE_TEXT: Record<JobState, string> = {
  queued: "排隊中",
  sending: "送出中",
  choose: "請選擇",
  done: "已記帳",
  failed: "失敗",
  unsent: "沒記到",
  checking: "確認中",
};

const MAX_JOBS = 40;
/** 選單開著時，單獨按一個數字鍵、這段時間內沒有其他按鍵才算選擇（條碼槍會連續打很多字） */
const PICK_DELAY_MS = 150;

function describeSale(sale: SaleDto): string {
  return `${sale.setName} ×${sale.quantity} ${formatMoney(sale.amount)}`;
}

export function CounterPage() {
  const { branchId, branchName } = useApp();
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const jobsRef = useRef<Job[]>([]);
  const busyRef = useRef(false);
  const onlineRef = useRef(true);
  const branchRef = useRef(branchId);
  branchRef.current = branchId;

  const [online, setOnline] = useState(true);
  const [text, setText] = useState("");
  const [last, setLast] = useState<CounterSale | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "fail" | "info"; text: string } | null>(null);
  const [modal, setModal] = useState<null | "amount" | "package" | "open">(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickTimer = useRef<number | undefined>(undefined);

  // ---- 排隊送出 ----

  function enqueue(job: Omit<Job, "key" | "state">) {
    const jobs = jobsRef.current;
    jobs.push({ ...job, key: newClientId(), state: "queued" });
    // 舊的、已經結束的紀錄只留最近的
    while (jobs.length > MAX_JOBS) {
      const i = jobs.findIndex((j) => j.state === "done" || j.state === "failed");
      if (i < 0) break;
      jobs.splice(i, 1);
    }
    rerender();
    void pump();
  }

  async function pump() {
    if (busyRef.current || !onlineRef.current) return;
    const job = jobsRef.current.find((j) => j.state === "queued");
    if (!job) return;
    busyRef.current = true;
    job.state = "sending";
    rerender();
    let waitForChoice = false;
    try {
      const res = await api<ScanResponse>("/counter/scan", {
        body: {
          clientId: job.key,
          branchId: branchRef.current,
          barcode: job.barcode,
          setId: job.setId,
          quantity: job.quantity,
          type: job.type,
          amount: job.amount,
        },
      });
      if (res.status === "choose") {
        job.state = "choose";
        job.candidates = res.candidates;
        waitForChoice = true;
      } else {
        job.state = "done";
        job.message = describeSale(res.sale) + (res.duplicate ? "（之前已記過）" : "");
        setLast({ sale: res.sale, set: res.set });
        setNotice({ tone: "ok", text: `已記帳：${job.message}` });
        beep("ok");
      }
    } catch (e) {
      if (e instanceof NetworkError) {
        // 送出後沒收到回應：不知道有沒有記到，連線恢復後用 clientId 查
        job.state = "checking";
        goOffline();
      } else if (e instanceof ApiError && e.status >= 500) {
        job.state = "checking";
        void verify(job);
      } else {
        job.state = "failed";
        job.message = errorMessage(e);
        setNotice({ tone: "fail", text: `${job.label}：${job.message}` });
        beep("fail");
      }
    } finally {
      if (!waitForChoice) busyRef.current = false;
      rerender();
      if (!waitForChoice) void pump();
    }
  }

  function choose(job: Job, index: number) {
    const picked = job.candidates?.[index];
    if (job.state !== "choose" || !picked) return;
    job.setId = picked.id;
    job.label = `${job.barcode}（${picked.name}）`;
    job.candidates = undefined;
    job.state = "queued";
    busyRef.current = false;
    rerender();
    void pump();
  }

  function cancelChoice(job: Job) {
    if (job.state !== "choose") return;
    job.state = "failed";
    job.message = "已取消，沒有記帳";
    job.candidates = undefined;
    busyRef.current = false;
    rerender();
    void pump();
  }

  // ---- 斷線處理 ----

  async function verify(job: Job) {
    try {
      const { sale } = await api<{ sale: SaleDto | null }>(`/counter/sale-by-client/${job.key}`);
      if (sale) {
        job.state = "done";
        job.message = `已記到：${describeSale(sale)}`;
      } else {
        job.state = "unsent";
        job.message = "沒記到，請到銷售紀錄補登";
      }
    } catch (e) {
      if (e instanceof NetworkError) {
        goOffline();
        return;
      }
      job.state = "unsent";
      job.message = `無法確認（${errorMessage(e)}），請到銷售紀錄查看`;
    }
    rerender();
  }

  function goOffline() {
    const wasOnline = onlineRef.current;
    onlineRef.current = false;
    setOnline(false);
    for (const j of jobsRef.current) {
      if (j.state === "queued" || j.state === "choose") {
        j.state = "unsent";
        j.message = "斷線時還沒送出，沒記到";
        j.candidates = undefined;
      }
    }
    if (!jobsRef.current.some((j) => j.state === "sending")) busyRef.current = false;
    if (wasOnline) beep("fail");
    rerender();
  }

  function goOnline() {
    if (onlineRef.current) return;
    onlineRef.current = true;
    setOnline(true);
    for (const j of jobsRef.current) if (j.state === "checking") void verify(j);
    rerender();
  }

  // 連線偵測：連線中每 10 秒、斷線時每 3 秒問一次伺服器
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      window.clearTimeout(timer);
      try {
        await api("/version");
        goOnline();
      } catch (e) {
        if (e instanceof NetworkError) goOffline();
      }
      if (!stopped) timer = window.setTimeout(tick, onlineRef.current ? 10_000 : 3_000);
    };
    const onOffline = () => goOffline();
    const onOnline = () => void tick();
    timer = window.setTimeout(tick, online ? 10_000 : 3_000);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [online]);

  // 打開頁面時帶出本分店今天最近一筆櫃檯銷售，讓「改金額」接得上
  useEffect(() => {
    let cancelled = false;
    api<CounterSale | null>(`/counter/last?branchId=${branchId}`)
      .then((res) => {
        if (res && !cancelled) setLast((cur) => cur ?? res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  // 輸入框常駐游標：沒有對話框、也沒有在打其他欄位時，把游標拉回來
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = inputRef.current;
      if (!el || el.disabled || document.querySelector(".modal-backdrop")) return;
      const active = document.activeElement;
      if (active === el) return;
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
      el.focus();
    }, 300);
    return () => window.clearInterval(id);
  }, []);

  // ---- 輸入框 ----

  const choosing = jobsRef.current.find((j) => j.state === "choose");

  const onChange = (value: string) => {
    setText(value);
    window.clearTimeout(pickTimer.current);
    if (choosing && /^[1-9]$/.test(value) && Number(value) <= (choosing.candidates?.length ?? 0)) {
      pickTimer.current = window.setTimeout(() => {
        if (inputRef.current?.value !== value) return;
        setText("");
        choose(choosing, Number(value) - 1);
      }, PICK_DELAY_MS);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      window.clearTimeout(pickTimer.current);
      const parsed = parseScanInput(text);
      setText("");
      if (!parsed) return;
      enqueue({ label: parsed.barcode, barcode: parsed.barcode, quantity: parsed.quantity, type: "normal" });
    } else if (e.key === "Escape" && choosing) {
      e.preventDefault();
      cancelChoice(choosing);
    }
  };

  const pendingQty = /^(\d+)\s*[*＊]$/.exec(text.trim())?.[1];

  // ---- 動作 ----

  const revokeLast = async () => {
    try {
      const res = await api<CounterSale>("/counter/revoke-last", { body: { branchId } });
      setNotice({ tone: "info", text: `已撤銷：${describeSale(res.sale)}` });
      setLast((cur) => (cur?.sale.id === res.sale.id ? null : cur));
      beep("ok");
    } catch (e) {
      setNotice({ tone: "fail", text: `撤銷失敗：${errorMessage(e)}` });
      beep("fail");
      if (e instanceof NetworkError) goOffline();
    }
  };

  const jobs = [...jobsRef.current].reverse();

  return (
    <div className="counter">
      <div className="counter-head">
        <h1>櫃檯 · {branchName}</h1>
        {!online && (
          <div className="offline-banner" role="alert">
            ⚠ 斷線中，暫停記帳。連線恢復後會自動解除；斷線期間的銷售請事後補登。
          </div>
        )}
      </div>

      <div className={`scan-box${online ? "" : " disabled"}`}>
        <input
          ref={inputRef}
          className="scan-input"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!online}
          placeholder={online ? "刷條碼（多抽：先打數字再按 *，例如 3*）" : "斷線中"}
          aria-label="刷條碼"
          autoComplete="off"
          autoFocus
        />
        <div className="scan-hint">
          {pendingQty ? <strong>數量 {pendingQty} 抽，接著刷條碼</strong> : "沒輸入數量時記 1 抽"}
        </div>
      </div>

      {choosing && (
        <div className="choose-panel" role="dialog" aria-label="選擇要記哪一套">
          <div className="choose-title">
            條碼 {choosing.barcode} 對到 {choosing.candidates?.length} 套，按數字鍵選擇（Esc 取消）
          </div>
          <ol className="choose-list">
            {choosing.candidates?.map((c, i) => (
              <li key={c.id}>
                <button type="button" onClick={() => choose(choosing, i)}>
                  <span className="choose-key">{i + 1}</span>
                  <span className="choose-name">{c.name}</span>
                  <span className="muted">
                    {formatMoney(c.pricePerDraw)}／抽 · 剩 {c.totalDraws - c.soldDraws} 抽
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="link-button" onClick={() => cancelChoice(choosing)}>
            取消
          </button>
        </div>
      )}

      {notice && <div className={`notice tone-${notice.tone}`}>{notice.text}</div>}

      <div className="counter-grid">
        <section className="card">
          <h2>最近一筆</h2>
          {last ? (
            <div className="last-sale">
              <div className="last-name">{last.sale.setName}</div>
              <div className="last-numbers">
                <span>×{last.sale.quantity}</span>
                <span className="last-amount">{formatMoney(last.sale.amount)}</span>
              </div>
              <div className="muted">
                已賣 {last.set.soldDraws}／{last.set.totalDraws} 抽 · 剩 {last.set.totalDraws - last.set.soldDraws} 抽
              </div>
            </div>
          ) : (
            <p className="muted">還沒有銷售</p>
          )}
          <div className="button-row">
            <button type="button" disabled={!last || !online} onClick={() => setModal("amount")}>
              改金額
            </button>
            <button type="button" disabled={!online} onClick={() => void revokeLast()}>
              撤銷上一筆
            </button>
            <button type="button" disabled={!online} onClick={() => setModal("package")}>
              包套
            </button>
            <button type="button" disabled={!online} onClick={() => setModal("open")}>
              開套
            </button>
          </div>
        </section>

        <section className="card">
          <h2>刷條碼紀錄</h2>
          {jobs.length === 0 ? (
            <p className="muted">刷過的條碼會列在這裡</p>
          ) : (
            <ul className="job-list">
              {jobs.map((j) => (
                <li key={j.key} className={`job job-${j.state}`}>
                  <span className="job-state">{STATE_TEXT[j.state]}</span>
                  <span className="job-label">
                    {j.type === "normal" && j.quantity > 1 ? `${j.quantity}× ` : ""}
                    {j.label}
                  </span>
                  {j.message && <span className="job-message">{j.message}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {modal === "open" && (
        <OpenSetModal
          onClose={() => setModal(null)}
          onSaved={(created) => {
            setModal(null);
            setNotice({ tone: "ok", text: `已開套：${created.name}（${created.totalDraws} 抽）` });
          }}
        />
      )}
      {modal === "amount" && last && (
        <AmountModal
          branchId={branchId}
          last={last}
          onClose={() => setModal(null)}
          onSaved={(res) => {
            setLast(res);
            setNotice({ tone: "ok", text: `已改金額：${describeSale(res.sale)}` });
            setModal(null);
          }}
        />
      )}
      {modal === "package" && (
        <PackageModal
          branchId={branchId}
          onClose={() => setModal(null)}
          onConfirm={(set, amount) => {
            setModal(null);
            enqueue({
              label: `包套：${set.name}`,
              setId: set.id,
              quantity: set.totalDraws - set.soldDraws,
              type: "package",
              amount,
            });
          }}
        />
      )}
    </div>
  );
}

function AmountModal({
  branchId,
  last,
  onClose,
  onSaved,
}: {
  branchId: number;
  last: CounterSale;
  onClose: () => void;
  onSaved: (res: CounterSale) => void;
}) {
  const [value, setValue] = useState(String(last.sale.amount));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = toInt(value);
    if (amount === null || amount < 0) {
      setError("請輸入 0 以上的整數");
      return;
    }
    setBusy(true);
    try {
      onSaved(
        await api<CounterSale>("/counter/change-amount", { body: { saleId: last.sale.id, branchId, amount } }),
      );
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="改最近一筆的實收金額" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p>
          {last.sale.setName} ×{last.sale.quantity}
        </p>
        <Field label="實收金額">
          <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
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

function PackageModal({
  branchId,
  onClose,
  onConfirm,
}: {
  branchId: number;
  onClose: () => void;
  onConfirm: (set: PublicSetDto, amount: number) => void;
}) {
  const [sets, setSets] = useState<PublicSetDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<PublicSetDto | null>(null);
  const [price, setPrice] = useState("");

  useEffect(() => {
    api<PublicSetDto[]>(`/counter/sets?branchId=${branchId}`)
      .then(setSets)
      .catch((e) => setError(errorMessage(e)));
  }, [branchId]);

  const q = filter.trim();
  const visible = (sets ?? []).filter((s) => !q || s.barcode === q || s.name.includes(q));

  const onFilterKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (visible.length === 1) setPicked(visible[0]);
  };

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    const amount = toInt(price);
    if (!picked) return;
    if (amount === null || amount < 0) {
      setError("請輸入包套價");
      return;
    }
    onConfirm(picked, amount);
  };

  return (
    <Modal title="包套" onClose={onClose} wide>
      {!picked ? (
        <div className="form">
          <Field label="刷條碼或輸入品名">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={onFilterKey}
              autoFocus
              autoComplete="off"
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          {!sets ? (
            <p className="muted">載入中…</p>
          ) : visible.length === 0 ? (
            <p className="muted">本分店沒有符合的販售中套</p>
          ) : (
            <ul className="pick-list">
              {visible.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setPicked(s)}>
                    <span>{s.name}</span>
                    <span className="muted">
                      剩 {s.totalDraws - s.soldDraws} 抽 · {s.barcode}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <form className="form" onSubmit={confirm}>
          <p>
            <strong>{picked.name}</strong>：剩 {picked.totalDraws - picked.soldDraws} 抽全部賣出，確認後這套完售。
          </p>
          <Field label="包套價（實收金額）">
            <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="button-row">
            <button type="submit" className="primary">
              確認包套
            </button>
            <button type="button" onClick={() => setPicked(null)}>
              重選
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
