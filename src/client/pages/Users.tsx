import { useState, type FormEvent } from "react";
import { formatTaipei } from "../../shared/time";
import { ROLE_LABEL, type Role, type UserDto } from "../../shared/types";
import { api, errorMessage } from "../api";
import { ErrorText, Field, Modal } from "../components/ui";
import { useApp } from "../context";
import { useApi } from "../hooks";

type Dialog = { kind: "create" } | { kind: "edit"; user: UserDto } | { kind: "password"; user: UserDto };

/** 產生一組好唸、不會混淆（沒有 0/O、1/l/I）的密碼 */
function randomPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function UsersPage() {
  const { user: me } = useApp();
  const { data, error, reload } = useApi<UserDto[]>("/users");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const done = () => {
    setDialog(null);
    void reload();
  };

  const toggleDisabled = async (user: UserDto) => {
    if (!user.disabled && !window.confirm(`停用「${user.displayName}」？\n他所有電腦都會登出，也不能再登入。`)) return;
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body: { disabled: !user.disabled } });
      setActionError(null);
      void reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>使用者</h1>
        <button type="button" className="primary" onClick={() => setDialog({ kind: "create" })}>
          ＋ 新增帳號
        </button>
      </div>
      <p className="muted">
        工作人員只能用櫃檯、看板和今天的銷售，看不到成本。帳號不能刪除，不用時請停用，修改紀錄才查得到是誰做的。
      </p>

      <ErrorText>{actionError ?? error}</ErrorText>
      {!data ? (
        <p className="muted">載入中…</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>名稱</th>
              <th>登入帳號</th>
              <th>角色</th>
              <th>狀態</th>
              <th>建立時間</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className={u.disabled ? "disabled-row" : undefined}>
                <td>
                  {u.displayName}
                  {u.id === me.id && <span className="tag">你</span>}
                </td>
                <td className="mono">{u.username}</td>
                <td>{u.isOwner ? "店主（管理員）" : ROLE_LABEL[u.role]}</td>
                <td>{u.disabled ? <span className="tag tag-bad">已停用</span> : "使用中"}</td>
                <td>{formatTaipei(u.createdAt)}</td>
                <td className="actions">
                  {u.isOwner ? (
                    <span className="muted">密碼用 wrangler secret 修改</span>
                  ) : (
                    <>
                      <button type="button" className="link-button" onClick={() => setDialog({ kind: "edit", user: u })}>
                        編輯
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setDialog({ kind: "password", user: u })}
                      >
                        重設密碼
                      </button>
                      {u.id !== me.id && (
                        <button
                          type="button"
                          className={`link-button${u.disabled ? "" : " danger"}`}
                          onClick={() => void toggleDisabled(u)}
                        >
                          {u.disabled ? "恢復" : "停用"}
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialog?.kind === "create" && <CreateUserModal onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "edit" && (
        <EditUserModal user={dialog.user} isSelf={dialog.user.id === me.id} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "password" && (
        <ResetPasswordModal user={dialog.user} onClose={() => setDialog(null)} onSaved={done} />
      )}
    </div>
  );
}

function PasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="input-with-button">
      <input value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
      <button type="button" onClick={() => onChange(randomPassword())}>
        產生一組
      </button>
    </div>
  );
}

function CreateUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ displayName: "", username: "", role: "staff" as Role, password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/users", { body: { ...form, displayName: form.displayName.trim(), username: form.username.trim() } });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="新增帳號" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="名稱" hint="顯示在銷售和修改紀錄上，例如「小明」">
          <input value={form.displayName} onChange={(e) => update("displayName")(e.target.value)} autoFocus />
        </Field>
        <Field label="登入帳號" hint="英文、數字和 . _ -，3 到 32 個字">
          <input
            value={form.username}
            onChange={(e) => update("username")(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="角色">
          <select value={form.role} onChange={(e) => update("role")(e.target.value as Role)}>
            <option value="staff">工作人員（看不到成本）</option>
            <option value="admin">管理員</option>
          </select>
        </Field>
        <Field label="初始密碼" hint="至少 8 個字。建好後請告訴對方，他可以自己再改">
          <PasswordInput value={form.password} onChange={update("password")} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="button-row">
          <button type="submit" className="primary" disabled={busy}>
            建立
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: UserDto;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body: { displayName: displayName.trim(), role } });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`編輯：${user.displayName}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="名稱">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
        </Field>
        <Field label="角色" hint={isSelf ? "不能改自己的角色" : "改了立刻生效"}>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf}>
            <option value="staff">工作人員（看不到成本）</option>
            <option value="admin">管理員</option>
          </select>
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

function ResetPasswordModal({ user, onClose, onSaved }: { user: UserDto; onClose: () => void; onSaved: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/users/${user.id}/password`, { body: { password } });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`重設密碼：${user.displayName}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted">重設後，{user.displayName} 所有電腦上的登入都會登出，要用新密碼重新登入。</p>
        <Field label="新密碼" hint="至少 8 個字">
          <PasswordInput value={password} onChange={setPassword} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="button-row">
          <button type="submit" className="primary" disabled={busy || !password}>
            重設
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  );
}
