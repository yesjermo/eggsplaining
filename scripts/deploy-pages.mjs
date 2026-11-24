// Build the game for GitHub Pages and publish only the built files to the public site repo.
// The source repo stays private.
//
//   npm run deploy
//
// Uses your existing `gh`/git login. Supabase settings (public anon key, safe to ship) come
// from .env.production if present: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OWNER = 'yesjermo';
const SITE = 'eggsplaining-site';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

if (!existsSync('.env.production')) console.log('note: no .env.production, so this build ships without the world board');
else {
  const env = readFileSync('.env.production', 'utf8');
  if (/YOUR-|xxxx|abcd1234|your-key|\.\.\./i.test(env) || !/VITE_SUPABASE_URL=https:\/\/[a-z0-9]{10,}\.supabase\.co/.test(env)) {
    console.error('.env.production still has placeholder values. Put in your real Supabase Project URL and anon key first.');
    process.exit(1);
  }
  if (/service_role/i.test(env)) {
    console.error('.env.production looks like it has the service_role key. Use the anon public key instead.');
    process.exit(1);
  }
}

run('npm', ['run', 'build'], { env: { ...process.env, BASE_PATH: `/${SITE}/` } });

let exists = true;
try {
  out('gh', ['repo', 'view', `${OWNER}/${SITE}`, '--json', 'name']);
} catch {
  exists = false;
}
if (!exists) run('gh', ['repo', 'create', `${OWNER}/${SITE}`, '--public', '--description', 'Eggsplaining: hold, let go, don’t pop her. (built site)']);

const dir = mkdtempSync(join(tmpdir(), 'egg-pages-'));
try {
  cpSync('dist', dir, { recursive: true });
  writeFileSync(join(dir, '.nojekyll'), '');
  cpSync(join(dir, 'index.html'), join(dir, '404.html'));
  const sha = out('git', ['rev-parse', '--short', 'HEAD']);
  const git = (...a) => run('git', a, { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.name=eggsplaining-deploy', '-c', `user.email=${OWNER}@users.noreply.github.com`, 'commit', '-q', '-m', `Deploy ${sha}`);
  git('push', '-q', '--force', `https://github.com/${OWNER}/${SITE}.git`, 'main');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

try {
  out('gh', ['api', `repos/${OWNER}/${SITE}/pages`]);
} catch {
  run('gh', ['api', '-X', 'POST', `repos/${OWNER}/${SITE}/pages`, '-f', 'source[branch]=main', '-f', 'source[path]=/']);
}
console.log(`\nLive (give Pages a minute): https://${OWNER}.github.io/${SITE}/`);
