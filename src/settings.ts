// Per-browser preferences. Convenience only: everything still works if storage is blocked.

import { PRESET, sanitizeLook, cleanText, cleanCountry, regionFromLocale, type Look } from './shared/look.js';
import type { Mode } from './game/state';

export type { Look };

export interface Settings {
  look: Look;
  /** name shown on the world leaderboard */
  playerName: string;
  /** random id so the board keeps one best score per player */
  playerId: string;
  country: string;
  muted: boolean;
  reducedMotion: boolean;
  best: Record<Mode, number>;
}

const KEY = 'eggsplaining.settings.v2';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function newId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  }
}

export function guessCountry(): string {
  try {
    for (const l of navigator.languages ?? [navigator.language]) {
      const r = regionFromLocale(l);
      if (r) return r;
    }
  } catch {
    /* ignore */
  }
  return '';
}

export function defaultSettings(): Settings {
  return {
    look: { ...PRESET },
    playerName: '',
    playerId: newId(),
    country: guessCountry(),
    muted: false,
    reducedMotion: prefersReducedMotion(),
    best: { classic: 0, blitz: 0 },
  };
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      look: sanitizeLook(p.look),
      playerName: cleanText(p.playerName, '', 16),
      playerId: typeof p.playerId === 'string' && /^[a-z0-9]{12,40}$/.test(p.playerId) ? p.playerId : base.playerId,
      country: cleanCountry(p.country) || base.country,
      muted: !!p.muted,
      reducedMotion: p.reducedMotion ?? base.reducedMotion,
      best: {
        classic: Math.max(0, Number(p.best?.classic) || 0),
        blitz: Math.max(0, Number(p.best?.blitz) || 0),
      },
    };
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings last for this visit */
  }
}

export function flag(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return '';
  return String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
