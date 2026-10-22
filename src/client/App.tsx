import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ROLE_LABEL, type AuthUser, type Branch } from "../shared/types";
import { api, ApiError, errorMessage, onUnauthorized } from "./api";
import { ErrorText, Field, Modal } from "./components/ui";
import { AppContext, type AppState } from "./context";
import { CompletedPage } from "./pages/Completed";
import { CounterPage } from "./pages/Counter";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { ReportsPage } from "./pages/Reports";
import { SalesPage } from "./pages/Sales";
import { SetsPage } from "./pages/Sets";
import { UsersPage } from "./pages/Users";
import { Link, usePath } from "./router";
import { readLocalBranchId, writeLocalBranchId } from "./storage";

type AuthState =
  | { kind: "checking" }
  | { kind: "unreachable" }
  | { kind: "out" }
  | { kind: "in"; user: AuthUser };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: "checking" });

  useEffect(() => onUnauthorized(() => setAuth({ kind: "out" })), []);

  useEffect(() => {
    if (auth.kind !== "checking") return;
    api<{ user: AuthUser }>("/me")
      .then(({ user }) => setAuth({ kind: "in", user }))
      .catch((e) =>
        setAuth(e instanceof ApiError && e.status === 401 ? { kind: "out" } : { kind: "unreachable" }),
      );
  }, [auth]);

  if (auth.kind === "checking") return <p className="center muted">載入中…</p>;
  if (auth.kind === "unreachable") {
    return (
      <div className="center">
        <p>連不到伺服器，請確認網路。</p>
        <button type="button" onClick={() => setAuth({ kind: "checking" })}>
          重試
        </button>
      </div>
    );
  }
  if (auth.kind === "out") return <LoginPage onLoggedIn={(user) => setAuth({ kind: "in", user })} />;
  return <Shell key={auth.user.id} user={auth.user} onLoggedOut={() => setAuth({ kind: "out" })} />;
}

interface NavItem {
  to: string;
  label: string;
  /** 工作人員看到的名稱；沒有就是看不到 */
  staffLabel?: string;
}

const NAV: NavItem[] = [
  { to: "/", label: "櫃檯", staffLabel: "櫃檯" },
  { to: "/dashboard", label: "看板", staffLabel: "看板" },
  { to: "/completed", label: "已完售" },
  { to: "/sets", label: "套管理" },
  { to: "/sales", label: "銷售紀錄", staffLabel: "今天的銷售" },
  { to: "/reports", label: "報表" },
  { to: "/users", label: "使用者" },
];

function Shell({ user, onLoggedOut }: { user: AuthUser; onLoggedOut: () => void }) {
  const path = usePath();
  const isAdmin = user.role === "admin";
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<number | null>(readLocalBranchId);
  const [pickingBranch, setPickingBranch] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    api<Branch[]>("/branches")
      .then(setBranches)
      .catch((e) => setLoadError(errorMessage(e)));
  }, []);

  const state = useMemo<AppState | null>(() => {
    const branch = branches?.find((b) => b.id === branchId);
    if (!branches || !branch) return null;
    return {
      user,
      isAdmin,
      branches,
      branchId: branch.id,
      branchName: branch.name,
      branchNameOf: (id) => branches.find((b) => b.id === id)?.name ?? `分店 ${id}`,
    };
  }, [branches, branchId, user, isAdmin]);

  const chooseBranch = (id: number) => {
    writeLocalBranchId(id);
    setBranchId(id);
    setPickingBranch(false);
  };

  const logout = async (all: boolean) => {
    if (all && !window.confirm("所有電腦（包含櫃檯）都會被登出，要重新輸入密碼才能用。確定嗎？")) return;
    try {
      await api(all ? "/logout-all" : "/logout", { method: "POST" });
    } finally {
      onLoggedOut();
    }
  };

  if (loadError) return <p className="center error-text">{loadError}</p>;
  if (!branches) return <p className="center muted">載入中…</p>;

  if (!state && !isAdmin) {
    return (
      <div className="center">
        <p>這台電腦還沒設定是哪一家分店，請管理員登入設定後再使用。</p>
        <button type="button" onClick={() => void logout(false)}>
          登出
        </button>
      </div>
    );
  }

  if (!state || pickingBranch) {
    return (
      <Modal title="這台電腦在哪一家分店？" onClose={() => state && setPickingBranch(false)}>
        <p className="muted">只要選一次，會記在這台電腦上，只有管理員可以改。櫃檯刷條碼只會找這家分店的套。</p>
        <div className="branch-choices">
          {branches.map((b) => (
            <button key={b.id} type="button" className="primary big" onClick={() => chooseBranch(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  const nav = NAV.filter((n) => isAdmin || n.staffLabel);
  const allowed = nav.some((n) => n.to === path);

  let page;
  if (!allowed) {
    page = <p className="muted">{NAV.some((n) => n.to === path) ? "只有管理員可以看這一頁。" : "找不到這一頁。"}</p>;
  } else {
    switch (path) {
      case "/":
        page = <CounterPage />;
        break;
      case "/dashboard":
        page = <DashboardPage />;
        break;
      case "/completed":
        page = <CompletedPage />;
        break;
      case "/sets":
        page = <SetsPage />;
        break;
      case "/sales":
        page = <SalesPage />;
        break;
      case "/reports":
        page = <ReportsPage />;
        break;
      case "/users":
        page = <UsersPage />;
        break;
    }
  }

  return (
    <AppContext.Provider value={state}>
      <header className="topbar">
        <nav className="nav">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} className={path === n.to ? "active" : undefined}>
              {isAdmin ? n.label : n.staffLabel}
            </Link>
          ))}
        </nav>
        <div className="topbar-right">
          {isAdmin ? (
            <button type="button" className="link-button" onClick={() => setPickingBranch(true)}>
              本機分店：<strong>{state.branchName}</strong>
            </button>
          ) : (
            <span className="topbar-text">
              本機分店：<strong>{state.branchName}</strong>
            </span>
          )}
          <span className="topbar-user">
            {user.displayName}
            <span className="tag">{ROLE_LABEL[user.role]}</span>
          </span>
          {!user.isOwner && (
            <button type="button" className="link-button" onClick={() => setChangingPassword(true)}>
              改密碼
            </button>
          )}
          <button type="button" className="link-button" onClick={() => void logout(false)}>
            登出
          </button>
          {isAdmin && (
            <button type="button" className="link-button muted" onClick={() => void logout(true)}>
              登出所有電腦
            </button>
          )}
        </div>
      </header>
      <main className="page">{page}</main>
      {changingPassword && <PasswordModal onClose={() => setChangingPassword(false)} />}
    </AppContext.Provider>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const update = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.next !== form.confirm) return setError("兩次輸入的新密碼不一樣");
    setBusy(true);
    try {
      await api("/me/password", { body: { currentPassword: form.current, newPassword: form.next } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="修改密碼" onClose={onClose}>
      {done ? (
        <div className="form">
          <p>密碼已更新。其他電腦上用這個帳號的登入都已登出。</p>
          <div className="button-row">
            <button type="button" className="primary" onClick={onClose}>
              好
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <Field label="目前的密碼">
            <input
              type="password"
              value={form.current}
              onChange={(e) => update("current")(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </Field>
          <Field label="新密碼" hint="至少 8 個字，不要用生日或電話">
            <input
              type="password"
              value={form.next}
              onChange={(e) => update("next")(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="再輸入一次新密碼">
            <input
              type="password"
              value={form.confirm}
              onChange={(e) => update("confirm")(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="button-row">
            <button type="submit" className="primary" disabled={busy || !form.current || !form.next}>
              儲存
            </button>
            <button type="button" onClick={onClose}>
              取消
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
