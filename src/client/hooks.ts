import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";

export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** 打開頁面或 path 改變時抓資料；path 為 null 時不抓 */
export function useApi<T>(path: string | null): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const latest = useRef(path);
  latest.current = path;

  const reload = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (latest.current === path) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (latest.current === path) setError(errorMessage(e));
    } finally {
      if (latest.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

/**
 * 看板用：每 intervalMs 問一次最後修改版本號，跟 known 不同就呼叫 onChange。
 * 分頁不在前景時暫停，回到前景時馬上問一次。
 */
export function useVersionPolling(known: number | undefined, onChange: () => void, intervalMs = 10_000) {
  const knownRef = useRef(known);
  knownRef.current = known;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;

    const check = async () => {
      if (document.visibilityState !== "visible" || knownRef.current === undefined) return;
      try {
        const { version } = await api<{ version: number }>("/version");
        if (!stopped && version !== knownRef.current) onChangeRef.current();
      } catch {
        // 下一輪再試
      }
    };
    const schedule = () => {
      window.clearInterval(timer);
      if (document.visibilityState === "visible") timer = window.setInterval(check, intervalMs);
    };
    const onVisibility = () => {
      schedule();
      if (document.visibilityState === "visible") void check();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
