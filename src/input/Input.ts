import type { Dir } from '../core/Grid';

const KEYS: Record<string, Dir> = {
  ArrowUp: 0,
  KeyW: 0,
  ArrowRight: 1,
  KeyD: 1,
  ArrowDown: 2,
  KeyS: 2,
  ArrowLeft: 3,
  KeyA: 3,
};

/** Keyboard, swipe and on-screen arrow buttons, all mapped to a direction callback. */
export class Input {
  onDir: (d: Dir) => void = () => {};
  onPause: () => void = () => {};
  enabled = false;
  private touchStart: { x: number; y: number; id: number } | null = null;

  constructor(surface: HTMLElement, dpad: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPause();
        return;
      }
      const d = KEYS[e.code];
      if (d === undefined || !this.enabled) return;
      e.preventDefault();
      this.onDir(d);
    });

    // Swipe: fire as soon as the finger moves far enough, then re-anchor so you can chain turns.
    const threshold = () => Math.max(18, Math.min(window.innerWidth, window.innerHeight) * 0.035);
    surface.addEventListener(
      'touchstart',
      (e) => {
        const t = e.changedTouches[0];
        this.touchStart = { x: t.clientX, y: t.clientY, id: t.identifier };
      },
      { passive: true },
    );
    surface.addEventListener(
      'touchmove',
      (e) => {
        if (!this.touchStart || !this.enabled) return;
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier !== this.touchStart.id) continue;
          const dx = t.clientX - this.touchStart.x;
          const dy = t.clientY - this.touchStart.y;
          if (Math.hypot(dx, dy) < threshold()) continue;
          this.onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
          this.touchStart = { x: t.clientX, y: t.clientY, id: t.identifier };
        }
        e.preventDefault();
      },
      { passive: false },
    );
    surface.addEventListener('touchend', () => (this.touchStart = null), { passive: true });

    // Mouse drag works like swipe on desktop.
    let mouse: { x: number; y: number } | null = null;
    surface.addEventListener('mousedown', (e) => (mouse = { x: e.clientX, y: e.clientY }));
    window.addEventListener('mouseup', () => (mouse = null));
    surface.addEventListener('mousemove', (e) => {
      if (!mouse || !this.enabled) return;
      const dx = e.clientX - mouse.x;
      const dy = e.clientY - mouse.y;
      if (Math.hypot(dx, dy) < 24) return;
      this.onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
      mouse = { x: e.clientX, y: e.clientY };
    });

    dpad.querySelectorAll<HTMLElement>('[data-dir]').forEach((btn) => {
      const d = Number(btn.dataset.dir) as Dir;
      const press = (e: Event) => {
        e.preventDefault();
        if (this.enabled) this.onDir(d);
        btn.classList.add('pressed');
      };
      btn.addEventListener('touchstart', press, { passive: false });
      btn.addEventListener('mousedown', press);
      const up = () => btn.classList.remove('pressed');
      btn.addEventListener('touchend', up);
      btn.addEventListener('mouseup', up);
      btn.addEventListener('mouseleave', up);
    });
  }
}
