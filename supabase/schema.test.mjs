// Runs supabase/schema.sql inside an in-memory Postgres (PGlite) and checks the RPCs the
// browser calls. Supabase's anon/authenticated roles are created here so the grants apply.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

const SQL = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
const P1 = 'aaaaaaaaaaaaaaaa';
const P2 = 'bbbbbbbbbbbbbbbb';

let db;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;`);
  await db.exec(SQL);
});

const one = async (q, params = []) => (await db.query(q, params)).rows[0];
const startRun = async (mode = 'classic') => (await one('select public.start_run($1) as id', [mode])).id;
const age = (id, secs) => db.query(`update runs set started_at = now() - ($2 || ' seconds')::interval where id = $1`, [id, String(secs)]);
const submit = async (id, { mode = 'classic', score, name = 'Ana', country = 'US', player = P1, look = { hair: 'bob' } }) =>
  (await one('select public.submit_score($1,$2,$3,$4,$5,$6,$7) as r', [id, mode, score, name, country, player, JSON.stringify(look)])).r;
const board = async (mode = 'classic', period = 'all', player = null) =>
  (await one('select public.leaderboard($1,$2,50,$3) as r', [mode, period, player])).r;

async function play(opts) {
  const id = await startRun(opts.mode);
  await age(id, opts.secs ?? 60);
  return submit(id, opts);
}

describe('supabase leaderboard', () => {
  it('accepts a plausible score and ranks it', async () => {
    const r = await play({ score: 300 });
    expect(r.rank).toEqual({ all: 1, today: 1 });
    const b = await board();
    expect(b.rows[0]).toMatchObject({ rank: 1, name: 'Ana', country: 'US', score: 300 });
    expect(b.rows[0].look).toEqual({ hair: 'bob' });
    expect(b.rows[0]).not.toHaveProperty('player');
  });

  it('rejects impossible scores', async () => {
    await expect(play({ score: 100_000, secs: 10 })).rejects.toThrow(/not possible/);
  });

  it('a run is single-use and mode-locked', async () => {
    const id = await startRun('blitz');
    await age(id, 45);
    await expect(submit(id, { mode: 'classic', score: 10 })).rejects.toThrow(/Mode mismatch/);
    await submit(id, { mode: 'blitz', score: 10 });
    await expect(submit(id, { mode: 'blitz', score: 10 })).rejects.toThrow(/expired/);
  });

  it('keeps one best per player, separate boards per mode, and reports your rank', async () => {
    await play({ score: 200 });
    await play({ score: 150 });
    await play({ score: 260, player: P2, name: 'Bo' });
    await play({ score: 999, mode: 'blitz', secs: 46 });
    const b = await board('classic', 'all', P1);
    expect(b.rows.map((x) => [x.name, x.score])).toEqual([
      ['Bo', 260],
      ['Ana', 200],
    ]);
    expect(b.you).toEqual({ rank: 2, score: 200 });
    expect((await board('blitz')).rows).toHaveLength(1);
  });

  it('today only counts the current UTC day', async () => {
    await play({ score: 500 });
    await db.query(`update scores set at = now() - interval '2 days' where name = 'Ana'`);
    await play({ score: 100, player: P2, name: 'Bo' });
    expect((await board('classic', 'today')).rows.map((x) => x.name)).toEqual(['Bo']);
    expect((await board('classic', 'all')).rows.map((x) => x.name)).toEqual(['Ana', 'Bo']);
  });

  it('cleans names and countries, drops oversized looks', async () => {
    await play({ score: 50, name: '<b>hi</b>   there and a very long tail', country: 'usa', look: { pad: 'x'.repeat(3000) } });
    const row = (await board()).rows[0];
    expect(row.name).not.toMatch(/[<>]/);
    expect(row.name.length).toBeLessThanOrEqual(16);
    expect(row.country).toBe('');
    expect(row.look).toEqual({});
  });

  it('rejects bad modes and players', async () => {
    await expect(startRun('nope')).rejects.toThrow(/Unknown mode/);
    const id = await startRun();
    await age(id, 30);
    await expect(submit(id, { score: 1, player: 'BAD!' })).rejects.toThrow(/Missing player/);
  });

  it('anon cannot touch the tables directly, only the functions', async () => {
    await db.exec('set role anon');
    await expect(db.query('select * from scores')).rejects.toThrow(/permission denied/);
    await expect(db.query(`insert into scores (player,name,mode,score) values ('${P1}','x','classic',1)`)).rejects.toThrow(/permission denied/);
    const id = (await one(`select public.start_run('classic') as id`)).id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const b = (await one(`select public.leaderboard('classic','all',10,null) as r`)).r;
    expect(b.rows).toEqual([]);
  });
});
