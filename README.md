# Eggsplaining

Hold to pump a very nervous egg. Let go to bank the points. Don’t pop her. Then see where you rank against everyone else in the world.

**Play:** https://yesjermo.github.io/eggsplaining-site/

![Splash](marketing/splash.gif)

```bash
npm install
npm run dev      # game + a local leaderboard API on http://localhost:5173
npm test         # rules, input edge cases, local API, Supabase SQL (37 tests, vitest)
npm run deploy   # build and publish to GitHub Pages
```

## How to play

Hold Space, or the big button on a phone, to pump pressure and earn points. The longer you hold, the faster points come. Let go to bank them. Pop her and the points from that hold are gone.

- **Classic:** one egg, one pop. Every bank cools her off a little, moves the hidden line, and makes her touchier, so pressure builds faster and holds pay more. Your score is everything you banked before the pop.
- **ADHD mode (Blitz):** 45 seconds, faster pressure, and banks in a row build a combo (×1.5, ×2 … up to ×5). A pop wipes the hold and the combo and costs 3 seconds, but the run keeps going. It adds pop-up scores, haptics on Android, and Space to restart instantly.

A hold shorter than a beat banks nothing. Letting go of the button, a touch the phone cancels, and switching tabs all count as releasing.

Each mode has its own world leaderboard, for today (UTC) and all time, with one best score per player, country flags and mini Mii avatars.

## Reading her

There's no pressure meter. The gauge in the chamber wears a little cover. These cues are consistent and never faked:
- Blink rate goes from about every 3 s to several times a second.
- Her cheeks flush and puff out.
- A creak sound starts past halfway and speeds up.
- Cracks appear in the last quarter.

The fake tells are a serene grin near the edge and a panic face when she's actually safe. She also taps her foot when you hesitate, glances at the covered gauge on long holds, says "I’m fine." while shaking, and after a pop her soul floats out of the chamber with your custom line.

## The character

She's a Mii-style egg:
- **Head:** sculpted in 3D with Blender (round cheeks, soft jaw, button nose, low bun, curtain bangs).
- **Face:** painted 2D Mii parts that ease smoothly between expressions. Blinks close gradually, a smile widens into a grin, her brows lift by degrees and her lips wobble when she's nervous.

The same face painter draws the Mii Maker thumbnails, leaderboard avatars and the splash, so she looks the same everywhere.

**Mii Maker** (the "Make her yours" button) has these tabs:
- **Face:** skin, height, roundness
- **Hair:** 9 styles, 5 bangs, colour
- **Eyes:** 5 styles, size, spacing
- **Brows, Nose, Mouth:** with lip colour
- **Extras:** mole, blush, freckles, glasses and frame colour, favourite colour (outfit and sneakers)
- **Name:** her nickname, her after-pop line, your leaderboard name, your country

The default preset is in `src/shared/look.js`: low bun with wispy curtain bangs, sleepy monolid eyes, round cheeks, a chin mole and a purple top.

### Her 3D head (Blender)

`tools/blender/build_head.py` builds the head in Blender and exports `public/models/egg-head.glb` (about 445 KB):
- **Body:** the sculpted egg with UVs for the painted skin, plus a cheek **Puff** shape key for when she strains.
- **Nose:** a soft button that sits under the painted nose.
- **HairLowbun:**
  - a centre-parted cap with combed grooves, a rounded crown and a tucked hairline
  - a wrapped low bun with a scrunchie
  - wavy face-framing tendrils and a few flyaways
- **BangsWispy:** two layers of curtain bangs made of tapered clumps with a V-shaped cross-section, so they catch the light.

A vertex colour layer darkens roots and grooves. The game multiplies it by the chosen hair colour and adds a soft sheen. The other hairstyles are built in code.

Rebuild after editing the script. This also renders previews to `tools/blender/preview/`:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/blender/build_head.py
```

### Splash GIF

The splash shows her collapsed face-down while her soul floats up out of her, hand-drawn style. To regenerate the GIF, run `npm run dev` and open `/?gif=1`. It's written to `marketing/splash.gif` and `public/splash.gif`, which is also the link-preview image.

## Hosting

**Game:** GitHub Pages. The code stays in this private repo. `npm run deploy` (`scripts/deploy-pages.mjs`) builds the game with the right base path and publishes only the built files to the public repo `yesjermo/eggsplaining-site`. It refuses to build if `.env.production` still has placeholder values or a `service_role` key.

**World leaderboard:** Supabase, the project at `dnfbwhxdthrgnwpvrbax.supabase.co`.
- `supabase/schema.sql` creates two tables. Row level security keeps them locked, so nobody can read or write them directly.
- The browser can only call three functions:
  - `start_run(mode)` returns a single-use run id
  - `submit_score(...)` checks the run's mode and age, the score ceiling (the same one as `src/shared/limits.js`) and per-IP limits, then cleans the name, country and avatar and ranks the score
  - `leaderboard(mode, period, limit, player)` returns each player's best for today or all time, plus your rank
- The settings live in `.env.production`, which git ignores:
  ```
  VITE_SUPABASE_URL=https://dnfbwhxdthrgnwpvrbax.supabase.co
  VITE_SUPABASE_ANON_KEY=sb_publishable_...
  ```
  The publishable (anon) key is meant to ship inside the game. Never put the `service_role` or secret key here.
- To set it up in a new Supabase project: run `supabase/schema.sql` in its SQL Editor, put the new URL and publishable key in `.env.production`, then `npm run deploy`. Without that file the site still works, with personal bests only.
- To clear test scores, run this in the SQL Editor: `delete from scores where name = 'Setup test';`

**Local development:** `npm run dev` mounts a local version of the same leaderboard (`server/api.mjs`, stored in `.data/`), so you can play and post scores without touching the live board. `server.mjs` can serve the built game and that API together if you ever self-host (`npm run build && npm start`, port 8787).

## Structure

| Path | Role |
| --- | --- |
| `src/game/state.ts` | Pure rules for both modes, time passed in via `tick(dt)`, injectable RNG |
| `src/game/holdInput.ts` | Keyboard / pointer / touch-cancel / tab-switch → press and release |
| `src/shared/look.js`, `limits.js` | Look schema and validation, score ceilings (shared with the servers) |
| `src/miiface.ts` | Refined Mii face driven by a continuous pose, so expressions can ease |
| `src/face2d.ts` | 2D egg head, hair, bangs and ghost for thumbnails, avatars and the splash |
| `src/render/egg.ts` | Loads the Blender head, paints the face decal, eases expressions, body motion |
| `src/render/scene.ts` | Lightweight Three.js stage (no shadow maps), shards, confetti, soul, camera |
| `src/splash.ts` | Soul-leaving-body splash animation and GIF export |
| `src/ui/miimaker.ts` | Mii Maker sheet |
| `src/leaderboard.ts` | Leaderboard client: Supabase on the live site, local API in dev |
| `supabase/schema.sql` | Live leaderboard tables and functions (tested in PGlite) |
| `server/` | Local and self-host leaderboard API with JSON storage |
| `tools/blender/build_head.py` | Builds her 3D head and hair |
| `scripts/deploy-pages.mjs` | GitHub Pages deploy |

## Tests

`npm test` runs 37 tests:
- **Game rules:** hold and release, too-early releases, pops mid-hold, long frames, both modes, combos, the score ceiling, fake tells.
- **Input edge cases:** key auto-repeat, touch cancellation, second fingers, tab switching, rapid tapping.
- **Local leaderboard API.**
- **Supabase SQL:** runs in an in-memory Postgres, including a check that the public key can't touch the tables directly.
