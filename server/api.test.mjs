import { describe, expect, it } from 'vitest';
import { createApi, prune } from './api.mjs';
import { createMemoryStore } from './store.mjs';

function rig(start = Date.parse('2026-11-24T12:00:00Z')) {
  let t = start;
  const store = createMemoryStore();
  const api = createApi(store, { now: () => t, log: { error() {}, log() {} } });
  async function call(method, path, body, ip = '1.1.1.1') {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const req = {
      method,
      url: path,
      headers: { 'x-forwarded-for': ip },
      socket: {},
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    };
    let status = 0;
    let text = '';
    const res = {
      writeHead(s) {
        status = s;
        return this;
      },
      end(b) {
        text = b ?? '';
      },
    };
    const handled = await api(req, res);
    return { handled, status, body: text ? JSON.parse(text) : null };
  }
  return { store, call, advance: (ms) => (t += ms) };
}

const P1 = 'aaaaaaaaaaaaaaaa';
const P2 = 'bbbbbbbbbbbbbbbb';

async function play(r, { mode = 'classic', score, secs = 60, player = P1, name = 'Ana', ip } = {}) {
  const run = await r.call('POST', '/api/run', { mode }, ip);
  r.advance(secs * 1000);
  return r.call('POST', '/api/score', { runId: run.body.id, mode, score, name, country: 'US', playerId: player, look: { hair: 'bob' } }, ip);
}

describe('leaderboard api', () => {
  it('ignores non-api paths', async () => {
    const r = rig();
    expect((await r.call('GET', '/index.html')).handled).toBe(false);
  });

  it('accepts a plausible score and ranks it', async () => {
    const r = rig();
    const res = await play(r, { score: 300 });
    expect(res.status).toBe(200);
    expect(res.body.rank).toEqual({ all: 1, today: 1 });
    const lb = await r.call('GET', '/api/leaderboard?mode=classic&period=all');
    expect(lb.body.rows[0]).toMatchObject({ rank: 1, name: 'Ana', country: 'US', score: 300 });
    expect(lb.body.rows[0].look.hair).toBe('bob');
    expect(lb.body.rows[0]).not.toHaveProperty('player');
  });

  it('rejects scores faster than the per-second ceiling', async () => {
    const r = rig();
    const res = await play(r, { score: 100_000, secs: 10 });
    expect(res.status).toBe(422);
  });

  it('a run id can only be used once and must match the mode', async () => {
    const r = rig();
    const run = await r.call('POST', '/api/run', { mode: 'blitz' });
    r.advance(45_000);
    const bad = await r.call('POST', '/api/score', { runId: run.body.id, mode: 'classic', score: 10, playerId: P1 });
    expect(bad.status).toBe(400);
    const ok = await r.call('POST', '/api/score', { runId: run.body.id, mode: 'blitz', score: 10, playerId: P1 });
    expect(ok.status).toBe(200);
    const again = await r.call('POST', '/api/score', { runId: run.body.id, mode: 'blitz', score: 10, playerId: P1 });
    expect(again.status).toBe(400);
  });

  it('keeps one best score per player and separates modes', async () => {
    const r = rig();
    await play(r, { score: 200 });
    await play(r, { score: 150 });
    await play(r, { score: 260, player: P2, name: 'Bo' });
    await play(r, { score: 999, mode: 'blitz', secs: 46 });
    const lb = await r.call('GET', `/api/leaderboard?mode=classic&player=${P1}`);
    expect(lb.body.rows.map((x) => [x.name, x.score])).toEqual([
      ['Bo', 260],
      ['Ana', 200],
    ]);
    expect(lb.body.you).toEqual({ rank: 2, score: 200 });
    const blitz = await r.call('GET', '/api/leaderboard?mode=blitz');
    expect(blitz.body.rows).toHaveLength(1);
  });

  it('today only counts scores from the current UTC day', async () => {
    const r = rig(Date.parse('2026-11-24T23:00:00Z'));
    await play(r, { score: 500, secs: 60 });
    r.advance(2 * 60 * 60 * 1000);
    await play(r, { score: 100, player: P2, name: 'Bo' });
    const today = await r.call('GET', '/api/leaderboard?period=today');
    expect(today.body.rows.map((x) => x.name)).toEqual(['Bo']);
    const all = await r.call('GET', '/api/leaderboard?period=all');
    expect(all.body.rows.map((x) => x.name)).toEqual(['Ana', 'Bo']);
  });

  it('cleans names, countries and looks', async () => {
    const r = rig();
    const run = await r.call('POST', '/api/run', { mode: 'classic' });
    r.advance(60_000);
    await r.call('POST', '/api/score', {
      runId: run.body.id,
      mode: 'classic',
      score: 50,
      name: '<script>alert(1)</script> waaaaay too long a name',
      country: 'usa',
      playerId: P1,
      look: { skin: 'red', hair: 'mohawk', eyeSize: 99 },
    });
    const row = (await r.call('GET', '/api/leaderboard')).body.rows[0];
    expect(row.name).not.toMatch(/[<>]/);
    expect(row.name.length).toBeLessThanOrEqual(16);
    expect(row.country).toBe('');
    expect(row.look.hair).toBe('lowbun');
    expect(row.look.eyeSize).toBe(1.3);
    expect(row.look.skin).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('rate limits run creation per IP', async () => {
    const r = rig();
    let last;
    for (let i = 0; i < 35; i++) last = await r.call('POST', '/api/run', { mode: 'classic' }, '9.9.9.9');
    expect(last.status).toBe(429);
    expect((await r.call('POST', '/api/run', { mode: 'classic' }, '8.8.8.8')).status).toBe(200);
  });

  it('rejects oversized and malformed bodies', async () => {
    const r = rig();
    expect((await r.call('POST', '/api/run', { mode: 'x'.repeat(9000) })).status).toBe(413);
    expect((await r.call('POST', '/api/run', { mode: 'nope' })).status).toBe(400);
  });

  it('prune keeps every player best and recent entries', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    const old = new Date(now - 10 * 86400_000).toISOString();
    const entries = [
      { id: 'a', player: P1, mode: 'classic', score: 10, at: old },
      { id: 'b', player: P1, mode: 'classic', score: 5, at: old },
      { id: 'c', player: P2, mode: 'classic', score: 1, at: new Date(now).toISOString() },
    ];
    expect(prune(entries, now).map((e) => e.id).sort()).toEqual(['a', 'c']);
  });
});
