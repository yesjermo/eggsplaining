// Mii Maker-style editor: tabs of features, every option previewed with a live thumbnail.

import {
  BANGS,
  BROWS,
  EYES,
  GLASSES,
  GLASS_COLORS,
  HAIRS,
  HAIR_COLORS,
  LIPS,
  MOLES,
  MOUTHS,
  NOSES,
  OUTFITS,
  SKINS,
  cleanText,
  type Look,
} from '../shared/look.js';
import { drawHead2D, NEUTRAL } from '../face2d';
import { flag } from '../settings';

type Opt = { id: string; label: string };

export interface MakerHost {
  getLook(): Look;
  setLook(next: Look): void;
  getProfile(): { playerName: string; country: string };
  setProfile(p: { playerName: string; country: string }): void;
}

const TABS = ['Face', 'Hair', 'Eyes', 'Brows', 'Nose', 'Mouth', 'Extras', 'Name'] as const;
type Tab = (typeof TABS)[number];

export function createMaker(host: MakerHost) {
  const tabsEl = document.querySelector<HTMLElement>('#maker-tabs')!;
  const body = document.querySelector<HTMLElement>('#maker-body')!;
  const preview = document.querySelector<HTMLCanvasElement>('#maker-canvas')!;
  let tab: Tab = 'Face';
  let raf = 0;

  tabsEl.replaceChildren(
    ...TABS.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.textContent = t;
      b.addEventListener('click', () => {
        tab = t;
        render();
      });
      return b;
    }),
  );

  const change = (patch: Partial<Look>) => {
    host.setLook({ ...host.getLook(), ...patch });
    // colours and styles affect other thumbnails, so rebuild the tab
    render();
  };

  function drawPreview() {
    const ctx = preview.getContext('2d')!;
    const w = preview.width;
    const h = preview.height;
    ctx.clearRect(0, 0, w, h);
    const t = performance.now() / 1000;
    const blink = t % 3.4 < 0.12;
    drawHead2D(ctx, host.getLook(), w / 2, h * 0.58 + Math.sin(t * 2) * 2, h * 0.26, { ...NEUTRAL, eyes: blink ? 'blink' : 'open' });
  }

  function loop() {
    drawPreview();
    raf = requestAnimationFrame(loop);
  }

  function thumb(look: Look, zoom: 'head' | 'face'): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 120;
    const ctx = c.getContext('2d')!;
    if (zoom === 'face') drawHead2D(ctx, look, 60, 96, 64, NEUTRAL);
    else drawHead2D(ctx, look, 60, 70, 33, NEUTRAL);
    return c;
  }

  function group(label: string, ...children: HTMLElement[]) {
    const g = document.createElement('div');
    g.className = 'group';
    const s = document.createElement('span');
    s.textContent = label;
    g.append(s, ...children);
    return g;
  }

  function thumbs(label: string, key: keyof Look, opts: Opt[], zoom: 'head' | 'face') {
    const wrap = document.createElement('div');
    wrap.className = 'thumbs';
    const look = host.getLook();
    for (const o of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.k = String(key);
      b.dataset.v = o.id;
      b.setAttribute('aria-label', `${label}: ${o.label}`);
      const cap = document.createElement('span');
      cap.textContent = o.label;
      b.append(thumb({ ...look, [key]: o.id } as Look, zoom), cap);
      b.addEventListener('click', () => change({ [key]: o.id } as Partial<Look>));
      wrap.append(b);
    }
    return group(label, wrap);
  }

  function swatches(label: string, key: keyof Look, colors: string[]) {
    const wrap = document.createElement('div');
    wrap.className = 'swatches';
    colors.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.k = String(key);
      b.dataset.v = c;
      b.style.setProperty('--c', c);
      b.setAttribute('aria-label', `${label} ${i + 1}`);
      b.addEventListener('click', () => change({ [key]: c } as Partial<Look>));
      wrap.append(b);
    });
    return group(label, wrap);
  }

  function slider(label: string, key: keyof Look, min: number, max: number) {
    const l = document.createElement('label');
    l.className = 'slider';
    const s = document.createElement('span');
    s.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '0.01';
    input.value = String(host.getLook()[key]);
    input.addEventListener('input', () => host.setLook({ ...host.getLook(), [key]: Number(input.value) } as Look));
    l.append(s, input);
    return l;
  }

  function toggle(label: string, key: 'blush' | 'freckles') {
    const l = document.createElement('label');
    l.className = 'toggle';
    const s = document.createElement('span');
    s.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = host.getLook()[key];
    input.addEventListener('change', () => change({ [key]: input.checked }));
    l.append(s, input);
    return l;
  }

  function text(label: string, value: string, max: number, onInput: (v: string) => void, placeholder = '') {
    const l = document.createElement('label');
    l.className = 'text-field';
    const s = document.createElement('span');
    s.textContent = label;
    const input = document.createElement('input');
    input.value = value;
    input.maxLength = max;
    input.placeholder = placeholder;
    input.addEventListener('input', () => onInput(input.value));
    l.append(s, input);
    return l;
  }

  function render() {
    tabsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === tab)));
    const look = host.getLook();
    const parts: HTMLElement[] = [];
    switch (tab) {
      case 'Face':
        parts.push(swatches('Skin', 'skin', SKINS), group('Build', slider('Height', 'height', 0.85, 1.15), slider('Roundness', 'width', 0.85, 1.2)));
        break;
      case 'Hair':
        parts.push(thumbs('Style', 'hair', HAIRS, 'head'), thumbs('Bangs', 'bangs', BANGS, 'head'), swatches('Colour', 'hairColor', HAIR_COLORS));
        break;
      case 'Eyes':
        parts.push(thumbs('Eyes', 'eyes', EYES, 'face'), group('Adjust', slider('Size', 'eyeSize', 0.75, 1.3), slider('Spacing', 'eyeGap', 0.8, 1.25)));
        break;
      case 'Brows':
        parts.push(thumbs('Brows', 'brows', BROWS, 'face'));
        break;
      case 'Nose':
        parts.push(thumbs('Nose', 'nose', NOSES, 'face'));
        break;
      case 'Mouth':
        parts.push(thumbs('Mouth', 'mouth', MOUTHS, 'face'), swatches('Lip colour', 'lip', LIPS));
        break;
      case 'Extras':
        parts.push(
          thumbs('Mole', 'mole', MOLES, 'face'),
          group('Cheeks', toggle('Blush', 'blush'), toggle('Freckles', 'freckles')),
          thumbs('Glasses', 'glasses', GLASSES, 'face'),
          swatches('Frame colour', 'glassesColor', GLASS_COLORS),
          swatches('Favourite colour (outfit and sneakers)', 'outfit', OUTFITS),
        );
        break;
      case 'Name': {
        const prof = host.getProfile();
        const flagEl = document.createElement('span');
        flagEl.className = 'flag';
        flagEl.textContent = flag(prof.country);
        parts.push(
          text('Her nickname', look.nickname, 16, (v) => host.setLook({ ...host.getLook(), nickname: cleanText(v, 'Peggy', 16) })),
          text('After she pops she says', look.popLine, 40, (v) => host.setLook({ ...host.getLook(), popLine: cleanText(v, 'Why are you like this?', 40) })),
          text('Your name on the world board', prof.playerName, 16, (v) => host.setProfile({ ...host.getProfile(), playerName: cleanText(v, '', 16) }), 'Anonymous egg'),
          group(
            'Country',
            text(
              'Two-letter code',
              prof.country,
              2,
              (v) => {
                const c = v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
                host.setProfile({ ...host.getProfile(), country: c.length === 2 ? c : '' });
                flagEl.textContent = flag(c);
              },
              'US',
            ),
            flagEl,
          ),
        );
        break;
      }
    }
    const scroll = body.scrollTop;
    body.replaceChildren(...parts);
    body.scrollTop = scroll;
    const lk = host.getLook() as unknown as Record<string, unknown>;
    body.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((b) => {
      b.setAttribute('aria-pressed', String(String(lk[b.dataset.k!]) === b.dataset.v));
    });
  }

  return {
    open() {
      render();
      cancelAnimationFrame(raf);
      loop();
    },
    close() {
      cancelAnimationFrame(raf);
    },
  };
}
