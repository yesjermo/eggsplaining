// World leaderboard client. On the hosted site (GitHub Pages) it calls the Supabase RPCs in
// supabase/schema.sql with the public anon key; in dev it falls back to the local API that
// Vite mounts from server/api.mjs.

import type { Mode } from './game/state';
import type { Look } from './shared/look.js';

export interface BoardRow {
  rank: number;
  name: string;
  country: string;
  score: number;
  look: Look;
}
export interface Board {
  rows: BoardRow[];
  total: number;
  you: { rank: number; score: number } | null;
}
export interface Submitted {
  rank: { all: number | null; today: number | null };
  total: { all: number; today: number };
}
export interface ScoreIn {
  runId: string;
  mode: Mode;
  score: number;
  name: string;
  country: string;
  playerId: string;
  look: Look;
}

interface Backend {
  startRun(mode: Mode): Promise<string>;
  submit(s: ScoreIn): Promise<Submitted>;
  board(mode: Mode, period: 'today' | 'all', player: string): Promise<Board>;
}

const SUPA_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY!, authorization: `Bearer ${SUPA_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message || `Error ${res.status}`);
  return data as T;
}

const supabase: Backend = {
  startRun: (mode) => rpc<string>('start_run', { p_mode: mode }),
  submit: (s) =>
    rpc<Submitted>('submit_score', {
      p_run: s.runId,
      p_mode: s.mode,
      p_score: s.score,
      p_name: s.name,
      p_country: s.country,
      p_player: s.playerId,
      p_look: s.look,
    }),
  board: (mode, period, player) => rpc<Board>('leaderboard', { p_mode: mode, p_period: period, p_limit: 50, p_player: player }),
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Error ${res.status}`);
  return data as T;
}

const local: Backend = {
  startRun: async (mode) => (await api<{ id: string }>('/api/run', { mode })).id,
  submit: (s) => api<Submitted>('/api/score', s),
  board: (mode, period, player) => api<Board>(`/api/leaderboard?mode=${mode}&period=${period}&limit=50&player=${player}`),
};

/** null when this build has no world board configured. */
export const backend: Backend | null = SUPA_URL && SUPA_KEY ? supabase : import.meta.env.DEV ? local : null;
