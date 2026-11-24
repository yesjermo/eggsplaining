// Normalises keyboard, pointer, touch-cancel and focus-loss into one press/release pair.
// Kept free of DOM types so the edge cases can be unit tested.

import type { ReleaseReason } from './state';

export interface HoldTarget {
  press(): void;
  release(reason: ReleaseReason): void;
}

type Source = 'key' | 'pointer';

export class HoldInput {
  private down: Source | null = null;
  private pointerId: number | null = null;

  constructor(private target: HoldTarget) {}

  get isDown(): boolean {
    return this.down !== null;
  }

  /** keydown for the hold key. `repeat` is the browser's auto-repeat flag. */
  keyDown(repeat: boolean): void {
    if (repeat || this.down) return;
    this.down = 'key';
    this.target.press();
  }

  keyUp(): void {
    if (this.down !== 'key') return;
    this.down = null;
    this.target.release('release');
  }

  pointerDown(id: number): void {
    if (this.down) return; // second finger or key already holding: ignore
    this.down = 'pointer';
    this.pointerId = id;
    this.target.press();
  }

  pointerUp(id: number): void {
    if (this.down !== 'pointer' || id !== this.pointerId) return;
    this.down = null;
    this.pointerId = null;
    this.target.release('release');
  }

  /** pointercancel / touchcancel: the OS took the touch. Treat it as letting go. */
  pointerCancel(id: number): void {
    if (this.down !== 'pointer' || id !== this.pointerId) return;
    this.down = null;
    this.pointerId = null;
    this.target.release('cancel');
  }

  /** Window blur or tab hidden. Nobody can be holding a button they cannot see. */
  focusLost(): void {
    if (!this.down) return;
    this.down = null;
    this.pointerId = null;
    this.target.release('blur');
  }

  /** Forget any held state without releasing (used after the game itself ended the hold). */
  reset(): void {
    this.down = null;
    this.pointerId = null;
  }
}
