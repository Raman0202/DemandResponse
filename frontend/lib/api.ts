'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type Claims = { sub: string; role: string; name: string; dual: boolean; participant: string | null };

const TOKEN_KEY = 'gna.token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null) {
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function claims(): Claims | null {
  const t = getToken();
  if (!t) return null;
  try {
    const body = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (body.exp * 1000 < Date.now()) return null;
    return body as Claims;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).detail ?? msg;
    } catch {}
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export const post = <T = unknown>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export async function login(username: string, password: string): Promise<Claims> {
  const r = await post<{ token: string; user: Claims }>('/api/login', { username, password });
  setToken(r.token);
  return r.user;
}

function wsUrl(token: string) {
  const env = process.env.NEXT_PUBLIC_GNA_WS_URL;
  const base = env || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8000/ws`;
  return `${base}?token=${encodeURIComponent(token)}`;
}

/** Live control-room snapshot over WebSocket, with REST polling as fallback. */
export function useSnapshot() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [snap, setSnap] = useState<any>(null);
  const [link, setLink] = useState<'ws' | 'poll' | 'down'>('down');
  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnap(await api('/api/snapshot'));
    } catch {}
  }, []);

  useEffect(() => {
    let stop = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const startPoll = () => {
      if (poll) return;
      setLink('poll');
      poll = setInterval(refresh, 1000);
    };
    const connect = () => {
      const t = getToken();
      if (!t || stop) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl(t));
      } catch {
        startPoll();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        if (poll) clearInterval(poll);
        poll = null;
        setLink('ws');
      };
      ws.onmessage = (e) => setSnap(JSON.parse(e.data));
      ws.onclose = () => {
        if (stop) return;
        startPoll();
        retry = setTimeout(connect, 5000);
      };
    };
    refresh();
    connect();
    return () => {
      stop = true;
      wsRef.current?.close();
      if (poll) clearInterval(poll);
      if (retry) clearTimeout(retry);
    };
  }, [refresh]);

  return { snap, link, refresh };
}

/** Poll a JSON endpoint every `ms`. */
export function usePoll<T>(path: string, ms = 2000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    load();
    const id = setInterval(load, ms);
    return () => clearInterval(id);
  }, [load, ms]);
  return { data, error, reload: load };
}
