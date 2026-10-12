import type { Dir } from '../core/Grid';

const KEY_VEC: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
};

/**
 * Controls:
 * - floating joystick: touch/drag anywhere to steer in any direction
 * - a quick tap (or the throw button / Space) throws a ball
 * - keyboard: WASD/arrows in 8 directions
 * - optional on-screen arrow buttons (4 directions)
 */
export class Input {
  onAim: (angle: number) => void = () => {};
  onDir: (d: Dir) => void = () => {};
  onThrow: () => void = () => {};
  onPause: () => void = () => {};
  enabled = false;
  private held = new Set<string>();
  private stick: { id: number; x: number; y: number; t: number; moved: number } | null = null;

  constructor(surface: HTMLElement, dpad: HTMLElement, private readonly joy: HTMLElement, throwBtn: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPause();
        return;
      }
      if (!this.enabled) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!e.repeat) this.onThrow();
        return;
      }
      if (KEY_VEC[e.code]) {
        e.preventDefault();
        this.held.add(e.code);
        this.keyAim();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (this.held.delete(e.code)) this.keyAim();
    });
    window.addEventListener('blur', () => this.held.clear());

    // Floating joystick on the play surface (pointer events cover touch and mouse).
    const knob = joy.querySelector('.knob') as HTMLElement;
    const radius = 46;
    surface.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.stick) return;
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      joy.style.left = `${e.clientX}px`;
      joy.style.top = `${e.clientY}px`;
      knob.style.transform = 'translate(-50%, -50%)';
      joy.classList.remove('hidden');
      surface.setPointerCapture?.(e.pointerId);
    });
    surface.addEventListener('pointermove', (e) => {
      const s = this.stick;
      if (!s || e.pointerId !== s.id || !this.enabled) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      const len = Math.hypot(dx, dy);
      s.moved = Math.max(s.moved, len);
      const k = Math.min(1, radius / Math.max(1, len));
      knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
      if (len > 8) this.onAim(Math.atan2(dy, dx));
      // Let the base follow a finger that drags far away.
      if (len > radius * 1.6) {
        s.x = e.clientX - (dx / len) * radius * 1.6;
        s.y = e.clientY - (dy / len) * radius * 1.6;
        joy.style.left = `${s.x}px`;
        joy.style.top = `${s.y}px`;
      }
    });
    const end = (e: PointerEvent) => {
      const s = this.stick;
      if (!s || e.pointerId !== s.id) return;
      // A quick tap without dragging throws a ball.
      if (this.enabled && s.moved < 10 && performance.now() - s.t < 250) this.onThrow();
      this.stick = null;
      joy.classList.add('hidden');
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);

    const press = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.enabled) this.onThrow();
      throwBtn.classList.add('pressed');
      window.setTimeout(() => throwBtn.classList.remove('pressed'), 120);
    };
    throwBtn.addEventListener('pointerdown', press);

    dpad.querySelectorAll<HTMLElement>('[data-dir]').forEach((btn) => {
      const d = Number(btn.dataset.dir) as Dir;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.enabled) this.onDir(d);
        btn.classList.add('pressed');
      });
      const up = () => btn.classList.remove('pressed');
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointerleave', up);
    });
  }

  private keyAim(): void {
    let x = 0;
    let y = 0;
    for (const k of this.held) {
      x += KEY_VEC[k][0];
      y += KEY_VEC[k][1];
    }
    if (this.enabled && (x !== 0 || y !== 0)) this.onAim(Math.atan2(y, x));
  }

  reset(): void {
    this.stick = null;
    this.held.clear();
    this.joy.classList.add('hidden');
  }
}
