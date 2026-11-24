// Leaderboard API, framework-free so it runs both inside Vite (dev) and server.mjs (Render).
//
//   POST /api/run    {mode}                                   -> {id}
//   POST /api/score  {runId, mode, score, name, country, playerId, look} -> {ok, best, rank:{all,today}}
//   GET  /api/leaderboard?mode=classic|blitz&period=all|today&limit=50
//   GET  /api/health

import { randomBytes } from 'node:crypto';
import { sanitizeLook, cleanText, cleanCountry } from '../src/shared/look.js';
import { MAX_POINTS_PER_SEC, MODES } from '../src/shared/limits.js';

const RUN_TTL_MS = 2 * 60 * 60 * 1000;
const KEEP_ALL_TIME = 500;
const KEEP_RECENT_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;

/** Tiny fixed-window rate limiter. */
function limiter(max, windowMs) {
  const hits = new Map();
  return (key, now) => {
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) {
      hits.set(key, { start: now, n: 1 });
      if (hits.size > 10_000) hits.clear();
      return true;
    }
    h.n += 1;
    return h.n <= max;
  };
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function bestPerPlayer(entries) {
  const best = new Map();
  for (const e of entries) {
    const cur = best.get(e.player);
    if (!cur || e.score > cur.score || (e.score === cur.score && e.at < cur.at)) best.set(e.player, e);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || (a.at < b.at ? -1 : 1));
}

export function board(entries, mode, period, now) {
  const today = utcDay(now);
  const pool = entries.filter((e) => e.mode === mode && (period !== 'today' || e.at.slice(0, 10) === today));
  return bestPerPlayer(pool);
}

/** Keep each player's all-time best, the top of the board, and everything recent. */
export function prune(entries, now) {
  const keep = new Set();
  for (const mode of MODES) {
    const top = board(entries, mode, 'all', now);
    top.slice(0, KEEP_ALL_TIME).forEach((e) => keep.add(e.id));
  }
  for (const e of entries) if (now - Date.parse(e.at) < KEEP_RECENT_MS) keep.add(e.id);
  let out = entries.filter((e) => keep.has(e.id));
  if (out.length > MAX_ENTRIES) out = out.sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  return out;
}

export function createApi(store, { now = () => Date.now(), log = console } = {}) {
  const runs = new Map();
  const runLimit = limiter(30, 60_000);
  const scoreLimit = limiter(40, 60 * 60_000);

  function send(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(text);
  }

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 8_000) throw Object.assign(new Error('too large'), { status: 413 });
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw Object.assign(new Error('bad json'), { status: 400 });
    }
  }

  const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();

  function rankOf(rows, player) {
    const i = rows.findIndex((r) => r.player === player);
    return i < 0 ? null : i + 1;
  }

  const view = (e, i) => ({ rank: i + 1, name: e.name, country: e.country, score: e.score, at: e.at, look: e.look });

  /** @returns {Promise<boolean>} true if the request was handled */
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return false;
    const t = now();
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        send(res, 200, { ok: true, entries: store.get().entries.length, storage: store.status() });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
        const mode = MODES.includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'classic';
        const period = url.searchParams.get('period') === 'today' ? 'today' : 'all';
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        const rows = board(store.get().entries, mode, period, t);
        const me = url.searchParams.get('player');
        send(res, 200, {
          mode,
          period,
          total: rows.length,
          rows: rows.slice(0, limit).map(view),
          you: me ? (() => { const r = rankOf(rows, me); return r ? { rank: r, score: rows[r - 1].score } : null; })() : null,
        });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/run') {
        if (!runLimit(ipOf(req), t)) return send(res, 429, { error: 'Slow down a little.' }), true;
        const body = await readJson(req);
        const mode = MODES.includes(body.mode) ? body.mode : null;
        if (!mode) return send(res, 400, { error: 'Unknown mode.' }), true;
        for (const [k, r] of runs) if (t - r.start > RUN_TTL_MS) runs.delete(k);
        const id = randomBytes(12).toString('hex');
        runs.set(id, { mode, start: t });
        send(res, 200, { id });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/score') {
        if (!scoreLimit(ipOf(req), t)) return send(res, 429, { error: 'Too many scores from here. Try again later.' }), true;
        const body = await readJson(req);
        const run = runs.get(body.runId);
        if (!run) return send(res, 400, { error: 'That run expired. Play another one.' }), true;
        if (run.mode !== body.mode) return send(res, 400, { error: 'Mode mismatch.' }), true;
        const score = Math.floor(Number(body.score));
        const elapsed = (t - run.start) / 1000;
        if (!Number.isFinite(score) || score < 0) return send(res, 400, { error: 'Bad score.' }), true;
        if (score > MAX_POINTS_PER_SEC[run.mode] * elapsed + 50) return send(res, 422, { error: 'That score is not possible.' }), true;
        const player = typeof body.playerId === 'string' && /^[a-z0-9]{12,40}$/.test(body.playerId) ? body.playerId : null;
        if (!player) return send(res, 400, { error: 'Missing player.' }), true;
        runs.delete(body.runId); // one score per run
        const entry = {
          id: randomBytes(8).toString('hex'),
          player,
          name: cleanText(body.name, 'Anonymous egg', 16),
          country: cleanCountry(body.country),
          mode: run.mode,
          score,
          at: new Date(t).toISOString(),
          look: sanitizeLook(body.look),
        };
        const data = store.get();
        const entries = prune([...data.entries, entry], t);
        store.set({ ...data, entries });
        const all = board(entries, run.mode, 'all', t);
        const today = board(entries, run.mode, 'today', t);
        const best = all.find((e) => e.player === player)?.score ?? score;
        send(res, 200, { ok: true, best, rank: { all: rankOf(all, player), today: rankOf(today, player) }, total: { all: all.length, today: today.length } });
        return true;
      }

      send(res, 404, { error: 'Not found.' });
      return true;
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) log.error('[api]', e);
      send(res, status, { error: status === 413 ? 'Too large.' : status === 400 ? 'Bad request.' : 'Server error.' });
      return true;
    }
  };
}
