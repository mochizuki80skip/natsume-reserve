// API 呼び出しの共通処理
import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

/** 読み込み状態つきの取得フック。reload() で再取得できる */
export function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    getJson<T>(url)
      .then((j) => { if (alive) { setData(j); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof ApiError ? e : new ApiError(0, '通信に失敗しました')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
