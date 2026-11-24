import { defineConfig, type Plugin } from 'vite';
import { writeFile, mkdir } from 'node:fs/promises';

/** Dev only: run the real leaderboard API inside Vite, and let the splash save its GIF. */
function devServer(): Plugin {
  return {
    name: 'eggsplaining-dev',
    apply: 'serve',
    async configureServer(server) {
      const { createApi } = await import('./server/api.mjs');
      const { createFileStore } = await import('./server/store.mjs');
      const store = createFileStore({ DATA_DIR: '.data' } as NodeJS.ProcessEnv);
      await store.load();
      const api = createApi(store);
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/__save-gif' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          await mkdir('marketing', { recursive: true });
          await writeFile('marketing/splash.gif', Buffer.concat(chunks));
          await writeFile('public/splash.gif', Buffer.concat(chunks));
          res.end('saved');
          return;
        }
        if (await api(req, res)) return;
        next();
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; set BASE_PATH for that build
  base: process.env.BASE_PATH || '/',
  plugins: [devServer()],
  build: { chunkSizeWarningLimit: 700 },
});
