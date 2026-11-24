/* ==========================================================================
   AFTERIMAGE — deterministic platformer core
   Physics / simulation only: no rendering, no audio, no DOM. The game, the
   automated solver and the headless tests all import this same module, so a
   level proven solvable here is solvable in the build.
   ========================================================================== */

export const TILE = 32;
export const STEP = 1 / 60;

export const PHYS = {
  gravity: 2100,
  maxFall: 1150,
  runSpeed: 250,
  groundAccel: 2600,
  airAccel: 1750,
  friction: 2500,
  jumpSpeed: 650,
  jumpCut: 0.42,
  coyote: 0.1,
  buffer: 0.12,
  width: 16,
  height: 24,
};

const EMPTY = 0;
const SOLID = 1;
const SPIKE = 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const approach = (v, target, delta) =>
  v < target ? Math.min(v + delta, target) : Math.max(v - delta, target);

function tileIndex(map, w, h, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return SOLID;
  return map[ty * w + tx];
}

/* ------------------------------------------------------------------ level */

export function parseLevel(def) {
  const rows = def.map;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const map = new Uint8Array(w * h);
  let spawn = { x: 2 * TILE, y: 2 * TILE };
  const goal = { x: -999, y: -999, w: 26, h: 34 };
  const plates = [];
  const doors = [];
  const objects = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x] || '.';
      const i = y * w + x;
      if (c === '#') map[i] = SOLID;
      else if (c === '^') map[i] = SPIKE;
      else if (c === 'p') {
        spawn = { x: x * TILE + (TILE - PHYS.width) / 2, y: y * TILE + (TILE - PHYS.height) };
      } else if (c === 'o') {
        goal.x = x * TILE + 3;
        goal.y = y * TILE - 10;
        objects.push({ type: 'goal', x, y });
      } else if (c === 'P') {
        plates.push({ x: x * TILE, y: y * TILE, w: TILE, h: TILE, pressed: 0 });
        objects.push({ type: 'plate', x, y });
      } else if (c === 'D') {
        doors.push({ x: x * TILE, y: y * TILE });
        objects.push({ type: 'door', x, y });
        map[i] = SOLID;
      } else map[i] = EMPTY;
    }
  }

  return {
    name: def.name,
    chapter: def.chapter || 0,
    hint: def.hint || '',
    par: def.par ?? 2,
    maxEchoes: def.maxEchoes ?? def.par ?? 2,
    w,
    h,
    map,
    spawn,
    goal,
    plates,
    doors,
    objects,
    palette: def.palette ?? 0,
    mapRows: rows,
  };
}

/* ------------------------------------------------------------------- echo */

/**
 * An afterimage is a statue, not a replay: it holds the exact spot where the
 * previous attempt ended (a death, or the frame you let go). The recorded path
 * is kept only to draw the trail that leads to it.
 */
export class Echo {
  constructor(frames, cell) {
    this.frames = frames;
    this.tx = cell.x;
    this.ty = cell.y;
    this.reveal = 0;
  }

  update(dt) {
    this.reveal = Math.min(1, this.reveal + dt * 4);
  }

  get box() {
    return { x: this.tx * TILE, y: this.ty * TILE, w: TILE, h: TILE, solid: true };
  }

  get x() { return this.tx * TILE + (TILE - PHYS.width) / 2; }
  get y() { return this.ty * TILE + TILE - PHYS.height; }
}

/* ------------------------------------------------------------------ world */

export class World {
  constructor(levelDef) {
    this.level = parseLevel(levelDef);
    this.events = [];
    this.echoes = [];
    this.attempts = 0;
    this.state = 'play';
    this.stateT = 0;
    this.levelTime = 0;
    this.doorProgress = 0;
    this.startAttempt();
  }

  startAttempt() {
    const s = this.level.spawn;
    this.player = {
      x: s.x,
      y: s.y,
      w: PHYS.width,
      h: PHYS.height,
      vx: 0,
      vy: 0,
      onGround: false,
      coyote: 0,
      buffer: 0,
      jumpHeld: false,
      facing: 1,
      squash: 0,
    };
    this.frames = [];
    this.attemptTime = 0;
    this.state = 'play';
    this.stateT = 0;
    this.attempts++;
  }

  /** Turn the current run into a solid echo and restart instantly. */
  echoNow() {
    if (this.state !== 'play') return;
    this.commitEcho();
    this.startAttempt();
  }

  commitEcho() {
    if (this.frames.length < 4) return;
    const cell = this.echoCell(this.frames[this.frames.length - 1]);
    if (!cell) return;
    const frames = this.frames.map((f) => [f[0], f[1]]);
    this.echoes.push(new Echo(frames, cell));
    while (this.echoes.length > this.level.maxEchoes) this.echoes.shift();
    this.events.push({ type: 'echo', ...cell });
  }

  /** The body crystallises into the one free tile it was occupying. */
  echoCell([x, y]) {
    const cx = Math.floor((x + PHYS.width / 2) / TILE);
    const cy = Math.floor((y + PHYS.height / 2) / TILE);
    for (const dy of [0, -1, 1, -2]) {
      const ty = cy + dy;
      const t = tileIndex(this.level.map, this.level.w, this.level.h, cx, ty);
      if (t === EMPTY && !this.echoes.some((e) => e.tx === cx && e.ty === ty)) return { x: cx, y: ty };
    }
    return null;
  }

  die() {
    if (this.state !== 'play') return;
    this.state = 'dead';
    this.stateT = 0;
    this.events.push({ type: 'die', x: this.player.x, y: this.player.y });
    this.commitEcho();
  }

  respawn() {
    this.startAttempt();
  }

  restartLevel() {
    this.echoes.length = 0;
    this.attempts = 0;
    this.levelTime = 0;
    this.doorProgress = 0;
    this.startAttempt();
  }

  /* --------------------------------------------------------------- tiles */

  doorOpenAt(tx, ty) {
    if (this.doorProgress <= 0.55) return false;
    for (const d of this.level.doors) if (d.x === tx * TILE && d.y === ty * TILE) return true;
    return false;
  }

  hitsTile(x, y, w, h, kind = 'solid') {
    const x0 = Math.floor(x / TILE);
    const x1 = Math.floor((x + w - 0.01) / TILE);
    const y0 = Math.floor(y / TILE);
    const y1 = Math.floor((y + h - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = tileIndex(this.level.map, this.level.w, this.level.h, tx, ty);
        if (kind === 'spike') {
          if (t === SPIKE) return true;
        } else if (t === SOLID && !this.doorOpenAt(tx, ty)) return true;
      }
    }
    return false;
  }

  /* ---------------------------------------------------------------- step */

  step(input) {
    const dt = STEP;
    this.events.length = 0;

    if (this.state === 'dead') {
      this.stateT += dt;
      if (this.stateT > 0.3) this.respawn();
      return this.events;
    }
    if (this.state === 'won') {
      this.stateT += dt;
      return this.events;
    }

    this.levelTime += dt;
    this.attemptTime += dt;

    const allPressed = this.level.plates.length > 0 && this.level.plates.every((p) => p.pressed > 0);
    this.doorProgress = clamp(this.doorProgress + (allPressed ? dt * 6 : -dt * 6), 0, 1);

    const p = this.player;
    const P = PHYS;

    p.coyote = p.onGround ? P.coyote : Math.max(0, p.coyote - dt);
    p.buffer = input.jumpPressed ? P.buffer : Math.max(0, p.buffer - dt);

    let wish = 0;
    if (input.left) wish -= 1;
    if (input.right) wish += 1;
    if (wish !== 0) p.facing = wish;
    const accel = p.onGround ? P.groundAccel : P.airAccel;
    if (wish !== 0) p.vx = approach(p.vx, wish * P.runSpeed, accel * dt);
    else if (p.onGround) p.vx = approach(p.vx, 0, P.friction * dt);

    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = -P.jumpSpeed;
      p.buffer = 0;
      p.coyote = 0;
      p.onGround = false;
      p.jumpHeld = true;
      p.squash = -0.8;
      this.events.push({ type: 'jump', x: p.x + p.w / 2, y: p.y + p.h });
    }
    if (!input.jump && p.vy < 0 && p.jumpHeld) {
      p.vy *= P.jumpCut;
      p.jumpHeld = false;
    }
    if (input.jump) p.jumpHeld = true;

    p.vy = Math.min(p.vy + P.gravity * dt, P.maxFall);

    // --- horizontal
    const prevX = p.x;
    p.x += p.vx * dt;
    this.collideX(p, prevX);

    // --- vertical
    const prevY = p.y;
    const wasGround = p.onGround;
    p.y += p.vy * dt;
    const landed = this.collideY(p, prevY);
    if (landed) {
      if (!wasGround && p.vy > 330) {
        this.events.push({ type: 'land', x: p.x + p.w / 2, y: p.y + p.h, power: clamp(p.vy / 900, 0.2, 1) });
      }
      p.vy = 0;
      p.onGround = true;
      p.jumpHeld = false;
      if (Math.abs(p.squash) < 0.15) p.squash = 0.7;
    } else {
      p.onGround = false;
    }
    p.squash += (0 - p.squash) * Math.min(1, dt * 14);

    // --- echoes
    for (const e of this.echoes) e.update(dt);
    this.settleOnEchoes(p);

    // --- record
    this.frames.push([p.x, p.y]);

    // --- plates
    for (const plate of this.level.plates) {
      const pad = { x: plate.x - 14, y: plate.y + 6, w: plate.w + 28, h: plate.h - 6 };
      let down = overlaps(p, pad);
      if (!down) for (const e of this.echoes) if (overlaps(e.box, pad)) { down = true; break; }
      plate.pressed = down ? 1 : 0;
    }

    // --- hazards
    if (this.hitsTile(p.x + 3, p.y + 3, p.w - 6, p.h - 3, 'spike')) {
      this.die();
      return this.events;
    }
    if (p.y > this.level.h * TILE + 160) {
      this.die();
      return this.events;
    }

    // --- goal
    if (overlaps(p, this.level.goal)) {
      this.state = 'won';
      this.stateT = 0;
      this.events.push({ type: 'won', x: p.x, y: p.y });
    }

    return this.events;
  }

  collideX(p, prevX) {
    const P = PHYS;
    const dir = p.x > prevX ? 1 : p.x < prevX ? -1 : 0;
    if (!dir) return;
    const y0 = Math.floor((p.y + 2) / TILE);
    const y1 = Math.floor((p.y + P.height - 2) / TILE);
    const tx = dir > 0 ? Math.floor((p.x + P.width - 0.01) / TILE) : Math.floor(p.x / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      const t = tileIndex(this.level.map, this.level.w, this.level.h, tx, ty);
      if (t === SOLID && !this.doorOpenAt(tx, ty)) {
        p.x = dir > 0 ? tx * TILE - P.width : (tx + 1) * TILE;
        p.vx = 0;
        break;
      }
    }
    for (const e of this.echoes) {
      const b = e.box;
      if (!overlaps(p, b)) continue;
      if (p.y + P.height <= b.y + 4) continue; // standing on top: handled vertically
      if (dir > 0 && prevX + P.width <= b.x + 1) {
        p.x = b.x - P.width;
        p.vx = 0;
      } else if (dir < 0 && prevX >= b.x + b.w - 1) {
        p.x = b.x + b.w;
        p.vx = 0;
      }
    }
  }

  collideY(p, prevY) {
    const P = PHYS;
    let landed = false;
    const x0 = Math.floor((p.x + 2) / TILE);
    const x1 = Math.floor((p.x + P.width - 2) / TILE);

    if (p.vy > 0) {
      const ty = Math.floor((p.y + P.height - 0.01) / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        const t = tileIndex(this.level.map, this.level.w, this.level.h, tx, ty);
        if (t === SOLID && !this.doorOpenAt(tx, ty)) {
          p.y = ty * TILE - P.height;
          landed = true;
          break;
        }
      }
      for (const e of this.echoes) {
        const b = e.box;
        const prevBottom = prevY + P.height;
        if (p.x + P.width - 3 > b.x && p.x + 3 < b.x + b.w && prevBottom <= b.y + 8 && p.y + P.height >= b.y) {
          p.y = b.y - P.height;
          landed = true;
        }
      }
    } else if (p.vy < 0) {
      const ty = Math.floor(p.y / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        const t = tileIndex(this.level.map, this.level.w, this.level.h, tx, ty);
        if (t === SOLID && !this.doorOpenAt(tx, ty)) {
          p.y = (ty + 1) * TILE;
          p.vy = 0;
          break;
        }
      }
    }
    return landed;
  }

  settleOnEchoes(p) {
    const P = PHYS;
    for (const e of this.echoes) {
      const b = e.box;
      if (!overlaps(p, b)) continue;
      const up = p.y + P.height - b.y;
      if (up <= 12) {
        p.y = b.y - P.height;
        p.vy = 0;
        p.onGround = true;
        continue;
      }
      const left = p.x + P.width - b.x;
      const right = b.x + b.w - p.x;
      if (left < right) { p.x = b.x - P.width; p.vx = Math.min(p.vx, 0); }
      else { p.x = b.x + b.w; p.vx = Math.max(p.vx, 0); }
    }
  }
}

export function overlaps(a, b) {
  const aw = a.w ?? PHYS.width;
  const ah = a.h ?? PHYS.height;
  return a.x < b.x + b.w && a.x + aw > b.x && a.y < b.y + b.h && a.y + ah > b.y;
}

/* --------------------------------------------------------------- headless */

/**
 * Runs a list of attempts (each a list of [keys, frames] segments) through a
 * fresh World. Keys: 'L' left, 'R' right, 'J' jump. Returns the world state.
 */
export function simulate(levelDef, attempts, opts = {}) {
  const w = new World(levelDef);
  let jumpPrev = false;
  let frames = 0;
  const maxFrames = opts.maxFrames ?? 60 * 60;

  for (let a = 0; a < attempts.length; a++) {
    if (a > 0) {
      // convert previous attempt into an echo, exactly like the player would.
      // A death already committed its own echo, so only living runs commit here.
      if (w.state === 'play') w.commitEcho();
      w.startAttempt();
    }
    for (const [keys, dur] of attempts[a]) {
      for (let i = 0; i < dur; i++) {
        const jump = keys.includes('J');
        const input = {
          left: keys.includes('L'),
          right: keys.includes('R'),
          jump,
          jumpPressed: jump && !jumpPrev,
        };
        jumpPrev = jump;
        w.step(input);
        frames++;
        if (w.state === 'won') return { won: true, world: w, frames, attempts: a + 1 };
        if (w.state === 'dead') break;
        if (frames > maxFrames) return { won: false, world: w, frames, attempts: a + 1 };
      }
      if (w.state === 'dead') break;
    }
  }
  return { won: w.state === 'won', world: w, frames, attempts: attempts.length };
}
