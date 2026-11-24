// Leaderboard storage: a small JSON file, optionally mirrored to a private GitHub repo so
// scores survive Render's free tier sleeping and redeploying.
//
// Env:
//   DATA_DIR      local folder for scores.json (default ./data)
//   GITHUB_TOKEN  fine-grained token with Contents read/write on DATA_REPO (optional)
//   DATA_REPO     owner/name of the backup repo, e.g. yesjermo/eggsplaining-data
//   DATA_PATH     file path inside the repo (default scores.json)

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const EMPTY = () => ({ version: 1, entries: [] });

export function createMemoryStore(initial = EMPTY()) {
  let data = initial;
  return {
    get: () => data,
    set(next) {
      data = next;
    },
    async load() {},
    async flush() {},
    status: () => ({ kind: 'memory' }),
  };
}

export function createFileStore(env = process.env, log = console) {
  const dir = env.DATA_DIR || join(process.cwd(), 'data');
  const file = join(dir, 'scores.json');
  const token = env.GITHUB_TOKEN || '';
  const repo = env.DATA_REPO || '';
  const path = env.DATA_PATH || 'scores.json';
  const gh = Boolean(token) && /^[\w.-]+\/[\w.-]+$/.test(repo);
  let data = EMPTY();
  let sha = null;
  let dirty = false;
  let timer = null;
  let lastBackup = null;
  let lastError = null;

  const api = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'eggsplaining-leaderboard',
  };

  async function pullGitHub() {
    const res = await fetch(api, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read ${res.status}`);
    const body = await res.json();
    sha = body.sha;
    return JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
  }

  async function pushGitHub() {
    const content = Buffer.from(JSON.stringify(data)).toString('base64');
    const put = () =>
      fetch(api, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ message: `scores: ${data.entries.length} entries`, content, ...(sha ? { sha } : {}) }),
      });
    let res = await put();
    if (res.status === 409 || res.status === 422) {
      // the sha went stale: refresh it and retry once
      await pullGitHub().catch(() => null);
      res = await put();
    }
    if (!res.ok) throw new Error(`GitHub write ${res.status}`);
    sha = (await res.json()).content?.sha ?? sha;
    lastBackup = new Date().toISOString();
  }

  async function writeLocal() {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, file);
  }

  const store = {
    get: () => data,
    set(next) {
      data = next;
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => store.flush().catch((e) => log.error('[scores] save failed:', e.message)), 15_000);
    },
    async load() {
      let local = null;
      try {
        local = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        /* no local file yet */
      }
      let remote = null;
      if (gh) {
        try {
          remote = await pullGitHub();
        } catch (e) {
          lastError = e.message;
          log.error('[scores] GitHub restore failed:', e.message);
        }
      }
      // keep whichever copy has more entries (a fresh container has no local file)
      const best = [remote, local]
        .filter((d) => d && Array.isArray(d.entries))
        .sort((a, b) => b.entries.length - a.entries.length)[0];
      data = best ?? EMPTY();
      log.log(`[scores] loaded ${data.entries.length} entries (${gh ? `GitHub ${repo}` : 'local file only'})`);
    },
    async flush() {
      if (!dirty) return;
      dirty = false;
      clearTimeout(timer);
      await writeLocal();
      if (gh) {
        try {
          await pushGitHub();
          lastError = null;
        } catch (e) {
          lastError = e.message;
          dirty = true;
          throw e;
        }
      }
    },
    status: () => ({ kind: gh ? 'github' : 'file', repo: gh ? repo : null, lastBackup, lastError }),
  };
  return store;
}
