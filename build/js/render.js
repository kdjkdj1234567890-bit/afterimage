/* ==========================================================================
   AFTERIMAGE — renderer
   Everything is drawn procedurally with Canvas2D: no image assets, no fonts
   to download, nothing that needs a server. The build is a handful of files.
   ========================================================================== */

import { TILE, PHYS } from './engine.js';

export const W = 32 * TILE;
export const H = 18 * TILE;

export const PALETTES = [
  {
    name: 'SIGNAL',
    bg0: '#070a10',
    bg1: '#0d1420',
    far: '#141d2c',
    mid: '#1b2738',
    tile: '#1d2a3d',
    tileEdge: '#33465f',
    tileTop: '#5b7896',
    accent: '#ffc46b',
    accent2: '#ffe6b8',
    ghost: '#8fd8ff',
    text: '#e8eef7',
    dim: '#7d8ea6',
  },
  {
    name: 'RUST',
    bg0: '#100a09',
    bg1: '#1a1210',
    far: '#251713',
    mid: '#33201a',
    tile: '#3a241d',
    tileEdge: '#5a3a2c',
    tileTop: '#8a5a41',
    accent: '#ff8a5c',
    accent2: '#ffd0b0',
    ghost: '#ffd9a8',
    text: '#f6ece4',
    dim: '#a68a7a',
  },
  {
    name: 'INK',
    bg0: '#060b0d',
    bg1: '#0b1518',
    far: '#112023',
    mid: '#172c30',
    tile: '#193036',
    tileEdge: '#2c4b52',
    tileTop: '#4f7d82',
    accent: '#8ef0c8',
    accent2: '#d6fff0',
    ghost: '#a8c8ff',
    text: '#e6f2f0',
    dim: '#7c9a99',
  },
];

const FONT = `"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;

function rnd(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.bg = document.createElement('canvas');
    this.bg.width = W;
    this.bg.height = H;
    this.particles = [];
    this.time = 0;
    this.shake = 0;
    this.flash = 0;
  }

  setLevel(level) {
    this.level = level;
    this.pal = PALETTES[level.palette % PALETTES.length];
    this.paintBackground();
  }

  /* ---------------------------------------------------------- background */

  paintBackground() {
    const level = this.level;
    const pal = this.pal;
    const c = this.bg.getContext('2d');
    c.clearRect(0, 0, W, H);

    const grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, pal.bg0);
    grad.addColorStop(0.55, pal.bg1);
    grad.addColorStop(1, pal.bg0);
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);

    const rand = rnd(1337 + level.palette * 97 + level.w * 13);

    // a low sun / halo behind everything
    const hx = W * (0.25 + rand() * 0.5);
    const hy = H * (0.28 + rand() * 0.15);
    const halo = c.createRadialGradient(hx, hy, 0, hx, hy, 420);
    halo.addColorStop(0, hexA(pal.accent, 0.16));
    halo.addColorStop(0.4, hexA(pal.accent, 0.05));
    halo.addColorStop(1, hexA(pal.accent, 0));
    c.fillStyle = halo;
    c.fillRect(0, 0, W, H);

    // far silhouettes: a skyline anchored to the floor line
    const floorY = H - 3 * TILE;
    c.fillStyle = pal.far;
    let x = -60;
    while (x < W + 60) {
      const bw = 54 + rand() * 110;
      const bh = 90 + rand() * 250;
      c.globalAlpha = 0.5;
      roundRect(c, x, floorY - bh, bw, bh + 12, 6);
      c.fill();
      c.globalAlpha = 1;
      x += bw + 14 + rand() * 40;
    }

    // mid layer: closer blocks with lit edges
    x = -80;
    while (x < W + 80) {
      const bw = 80 + rand() * 160;
      const bh = 40 + rand() * 190;
      c.fillStyle = pal.mid;
      roundRect(c, x, floorY - bh, bw, bh + 20, 8);
      c.fill();
      c.fillStyle = hexA(pal.tileTop, 0.25);
      c.fillRect(x, floorY - bh, bw, 2);
      if (rand() > 0.45) {
        c.fillStyle = hexA(pal.accent, 0.06);
        for (let wy = floorY - bh + 18; wy < floorY - 20; wy += 22) {
          if (rand() > 0.55) c.fillRect(x + bw * 0.3, wy, 5, 9);
          if (rand() > 0.7) c.fillRect(x + bw * 0.62, wy, 5, 9);
        }
      }
      x += bw + 26 + rand() * 70;
    }

    // horizon light along the floor line
    const hz = c.createLinearGradient(0, H - 4 * TILE - 40, 0, H - 4 * TILE + 10);
    hz.addColorStop(0, hexA(pal.accent, 0));
    hz.addColorStop(0.8, hexA(pal.accent, 0.05));
    hz.addColorStop(1, hexA(pal.accent, 0));
    c.fillStyle = hz;
    c.fillRect(0, H - 4 * TILE - 40, W, 50);

    // horizon haze
    const haze = c.createLinearGradient(0, H * 0.55, 0, H);
    haze.addColorStop(0, hexA(pal.bg0, 0));
    haze.addColorStop(1, hexA(pal.bg0, 0.85));
    c.fillStyle = haze;
    c.fillRect(0, 0, W, H);

    // dust
    for (let i = 0; i < 90; i++) {
      const dx = rand() * W;
      const dy = rand() * H;
      const r = 0.6 + rand() * 1.6;
      c.fillStyle = hexA(pal.text, 0.05 + rand() * 0.12);
      c.beginPath();
      c.arc(dx, dy, r, 0, Math.PI * 2);
      c.fill();
    }

    // vignette
    const vig = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = vig;
    c.fillRect(0, 0, W, H);
  }

  /* --------------------------------------------------------------- frame */

  draw(world, dt) {
    const ctx = this.ctx;
    const pal = this.pal;
    this.time += dt;

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 14);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4);

    ctx.save();
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.translate(sx, sy);
    ctx.drawImage(this.bg, 0, 0);

    this.drawTiles(world);
    this.drawPlates(world);
    this.drawDoors(world);
    this.drawGoal(world);
    for (const e of world.echoes) this.drawEcho(e, world);
    this.drawPlayer(world);
    this.drawParticles();
    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = hexA(pal.accent2, this.flash * 0.5);
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* --------------------------------------------------------------- world */

  drawTiles(world) {
    const ctx = this.ctx;
    const pal = this.pal;
    const level = world.level;
    const rows = level.mapRows;

    // pit interiors: everything below a column's first solid row reads as depth
    const surface = new Array(level.w).fill(level.h);
    for (let tx = 0; tx < level.w; tx++) {
      for (let ty = 0; ty < level.h; ty++) {
        if (rows[ty][tx] === '#') { surface[tx] = ty; break; }
      }
    }
    for (let tx = 0; tx < level.w; tx++) {
      if (surface[tx] >= level.h) continue;
      const y0 = surface[tx] * TILE;
      const g = ctx.createLinearGradient(0, y0, 0, level.h * TILE);
      g.addColorStop(0, 'rgba(2,4,8,0.35)');
      g.addColorStop(1, 'rgba(2,4,8,0.8)');
      ctx.fillStyle = g;
      ctx.fillRect(tx * TILE, y0, TILE, level.h * TILE - y0);
    }

    for (let ty = 0; ty < level.h; ty++) {
      let run = 0;
      for (let tx = 0; tx <= level.w; tx++) {
        const solid = tx < level.w && rows[ty][tx] === '#';
        if (solid) run++;
        else if (run > 0) {
          const x0 = (tx - run) * TILE;
          const wpx = run * TILE;
          const y0 = ty * TILE;
          const g = ctx.createLinearGradient(0, y0, 0, y0 + TILE);
          g.addColorStop(0, pal.tileTop);
          g.addColorStop(0.12, pal.tileEdge);
          g.addColorStop(0.35, pal.tile);
          g.addColorStop(1, shade(pal.tile, -18));
          ctx.fillStyle = g;
          ctx.fillRect(x0, y0, wpx, TILE);
          // top rim
          ctx.fillStyle = hexA(pal.accent2, 0.14);
          ctx.fillRect(x0, y0, wpx, 2);
          // vertical seams
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          for (let s = x0 + TILE; s < x0 + wpx; s += TILE) ctx.fillRect(s - 1, y0, 2, TILE);
          run = 0;
        }
      }
    }

    // spikes
    ctx.fillStyle = pal.tileEdge;
    for (let ty = 0; ty < level.h; ty++) {
      for (let tx = 0; tx < level.w; tx++) {
        if (rows[ty][tx] !== '^') continue;
        const x = tx * TILE;
        const y = ty * TILE;
        for (let i = 0; i < 3; i++) {
          const bx = x + i * (TILE / 3);
          ctx.beginPath();
          ctx.moveTo(bx, y + TILE);
          ctx.lineTo(bx + TILE / 6, y + 6);
          ctx.lineTo(bx + TILE / 3, y + TILE);
          ctx.closePath();
          ctx.fillStyle = shade(pal.tileEdge, -8);
          ctx.fill();
          ctx.fillStyle = hexA(pal.accent, 0.35);
          ctx.fillRect(bx + TILE / 6 - 1, y + 8, 2, TILE - 12);
        }
      }
    }
  }

  drawPlates(world) {
    const ctx = this.ctx;
    const pal = this.pal;
    for (const plate of world.level.plates) {
      const press = plate.pressed ? 1 : 0;
      const x = plate.x + 2;
      const y = plate.y + TILE - 8 + press * 4;
      const w = TILE - 4;
      roundRect(ctx, x, y, w, 8, 4);
      ctx.fillStyle = plate.pressed ? pal.accent : shade(pal.tileEdge, 12);
      ctx.fill();
      ctx.strokeStyle = hexA(pal.accent2, plate.pressed ? 0.85 : 0.25);
      ctx.lineWidth = 1;
      ctx.stroke();
      if (plate.pressed) {
        ctx.fillStyle = hexA(pal.accent, 0.12);
        ctx.beginPath();
        ctx.arc(plate.x + TILE / 2, plate.y + TILE / 2, 22 + Math.sin(this.time * 4) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawDoors(world) {
    const ctx = this.ctx;
    const pal = this.pal;
    const open = world.doorProgress ?? 0;
    for (const d of world.level.doors) {
      const hide = open * TILE * 0.92;
      const x = d.x + 3;
      const y = d.y - hide;
      const g = ctx.createLinearGradient(x, y, x + TILE, y);
      g.addColorStop(0, shade(pal.tile, -6));
      g.addColorStop(0.5, pal.tileEdge);
      g.addColorStop(1, shade(pal.tile, -10));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, TILE - 6, TILE);
      ctx.fillStyle = hexA(pal.accent, open > 0.05 ? 0.5 : 0.14);
      ctx.fillRect(x + 2, y + TILE - 6, TILE - 10, 3);
    }
  }

  drawGoal(world) {
    const ctx = this.ctx;
    const pal = this.pal;
    const g = world.level.goal;
    const cx = g.x + g.w / 2;
    const cy = g.y + g.h / 2;
    const t = this.time;

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 62);
    glow.addColorStop(0, hexA(pal.accent, 0.4));
    glow.addColorStop(0.5, hexA(pal.accent, 0.12));
    glow.addColorStop(1, hexA(pal.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 70, cy - 70, 140, 140);

    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate(t * (0.6 + i * 0.35) + i * 1.9);
      ctx.strokeStyle = hexA(i === 0 ? pal.accent2 : pal.accent, 0.75 - i * 0.18);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 13 + i * 5 + Math.sin(t * 2 + i) * 1.6, 21 + i * 4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = hexA(pal.accent2, 0.85);
    ctx.beginPath();
    ctx.arc(0, 0, 3.5 + Math.sin(t * 5) * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // rising sparks
    for (let i = 0; i < 5; i++) {
      const ph = (t * 0.5 + i * 0.2) % 1;
      const px = cx + Math.sin(t * 1.3 + i * 2.1) * 14;
      const py = cy + 26 - ph * 54;
      ctx.fillStyle = hexA(pal.accent2, (1 - ph) * 0.6);
      ctx.fillRect(px, py, 2, 2);
    }
  }

  drawEcho(echo, world) {
    const ctx = this.ctx;
    const pal = this.pal;
    const b = echo.box;
    const reveal = echo.reveal;
    const t = this.time;

    ctx.save();
    ctx.globalAlpha = 0.9 * Math.min(1, reveal * 2);

    // the last stretch of the run, so you can see how you got here
    const n = echo.frames.length;
    if (n > 8) {
      const from = Math.max(0, n - 40);
      ctx.beginPath();
      ctx.strokeStyle = hexA(pal.ghost, 0.07);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      for (let i = from; i < n; i += 2) {
        const [fx, fy] = echo.frames[i];
        const px = fx + PHYS.width / 2;
        const py = fy + PHYS.height / 2;
        if (i === from) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    g.addColorStop(0, hexA(pal.ghost, 0.26));
    g.addColorStop(1, hexA(pal.ghost, 0.1));
    roundRect(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 5);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = hexA(pal.ghost, 0.55 + Math.sin(t * 2 + b.x) * 0.12);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // inner silhouette: a memory of a body
    ctx.globalAlpha = 0.35 * Math.min(1, reveal * 2);
    ctx.fillStyle = hexA(pal.text, 0.5);
    roundRect(ctx, b.x + b.w / 2 - 4, b.y + 10, 8, b.h - 14, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + 8, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawPlayer(world) {
    const ctx = this.ctx;
    const pal = this.pal;
    const p = world.player;
    if (world.state === 'dead') return;

    const sq = p.squash;
    const w = PHYS.width * (1 - sq * 0.35);
    const h = PHYS.height * (1 + sq * 0.4);
    const x = p.x + (PHYS.width - w) / 2;
    const y = p.y + PHYS.height - h;

    // glow
    const gl = ctx.createRadialGradient(p.x + PHYS.width / 2, p.y + PHYS.height / 2, 2, p.x + PHYS.width / 2, p.y + PHYS.height / 2, 34);
    gl.addColorStop(0, hexA(pal.accent2, 0.22));
    gl.addColorStop(1, hexA(pal.accent2, 0));
    ctx.fillStyle = gl;
    ctx.fillRect(p.x - 30, p.y - 26, 76, 76);

    // scarf: a short ribbon that answers to velocity
    const vx = p.vx ?? 0;
    const len = Math.min(16, Math.abs(vx) * 0.06);
    if (len > 1) {
      ctx.beginPath();
      ctx.moveTo(x + (p.facing > 0 ? 2 : w - 2), y + 12);
      ctx.quadraticCurveTo(
        x + (p.facing > 0 ? -len * 0.6 : w + len * 0.6), y + 10 - Math.abs(vx) * 0.008,
        x + (p.facing > 0 ? -len : w + len), y + 16 + Math.sin(this.time * 12) * 1.5
      );
      ctx.strokeStyle = hexA(pal.ghost, 0.55);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // body
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, pal.accent2);
    g.addColorStop(0.55, pal.accent);
    g.addColorStop(1, shade(pal.accent, -22));
    roundRect(ctx, x, y, w, h, 6);
    ctx.fillStyle = g;
    ctx.fill();

    // visor
    ctx.fillStyle = 'rgba(12,14,20,0.82)';
    roundRect(ctx, x + 3, y + 4, w - 6, 6, 3);
    ctx.fill();
    ctx.fillStyle = hexA(pal.text, 0.9);
    const blink = Math.sin(this.time * 3) > -0.92 ? 1 : 0.2;
    ctx.globalAlpha = blink;
    ctx.fillRect(x + (p.facing > 0 ? w - 7 : 4), y + 6, 3, 2);
    ctx.globalAlpha = 1;

    // feet shadow
    if (p.onGround) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x + PHYS.width / 2, p.y + PHYS.height + 1, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ----------------------------------------------------------- particles */

  burst(x, y, count, opts = {}) {
    const pal = this.pal;
    for (let i = 0; i < count; i++) {
      const a = opts.angle !== undefined ? opts.angle + (Math.random() - 0.5) * (opts.spread ?? 1.6) : Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 90) * (0.35 + Math.random());
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (opts.lift ?? 0),
        life: opts.life ?? 0.5,
        max: opts.life ?? 0.5,
        size: opts.size ?? 2,
        color: opts.color ?? pal.accent,
        grav: opts.grav ?? 260,
      });
    }
    if (this.particles.length > 260) this.particles.splice(0, this.particles.length - 260);
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.fillStyle = hexA(p.color, a * 0.9);
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.5 * dt;
    }
  }
}

/* -------------------------------------------------------------- utilities */

export function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function shade(hex, amt) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => Math.max(0, Math.min(255, parseInt(h.slice(i, i + 2), 16) + amt)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
