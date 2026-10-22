import { useState, type FormEvent } from "react";
import type { AuthUser } from "../../shared/types";
import { api, errorMessage } from "../api";
import { ErrorText, Field } from "../components/ui";

export function LoginPage({ onLoggedIn }: { onLoggedIn: (user: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: AuthUser }>("/login", { body: { username, password } });
      onLoggedIn(user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>一番賞成本追蹤</h1>
        <Field label="帳號">
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </Field>
        <Field label="密碼">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="primary" disabled={busy || !username || !password}>
          {busy ? "登入中…" : "登入"}
        </button>
      </form>
    </div>
  );
}
