/* ==========================================================================
   AFTERIMAGE — app shell, screens, input and the fixed-step loop
   ========================================================================== */

import { World, STEP, Echo } from './engine.js';
import { LEVELS } from './levels.js';
import { Renderer, PALETTES } from './render.js';
import { SOLUTIONS } from './solutions.js';
import { AudioEngine } from './audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const screenEl = $('screen');
const panel = $('panel');
const hud = $('hud');
const hintEl = $('hint');
const toastEl = $('toast');

const renderer = new Renderer(canvas);
const audio = new AudioEngine();

const STORE = 'afterimage.progress.v1';
const progress = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || { unlocked: 0, best: {} };
  } catch {
    return { unlocked: 0, best: {} };
  }
})();
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(progress));
  } catch {}
};

let state = 'title';
let world = null;
let levelIndex = 0;
let accumulator = 0;
let last = performance.now();
let hintTimer = 0;
let auto = null;
let muted = localStorage.getItem('afterimage.muted') === '1';
let loopDisabled = false;

const keys = { left: false, right: false, jump: false };
let jumpEdge = false;

/* ------------------------------------------------------------------ input */

function readInput() {
  const jump = keys.jump;
  const input = { left: keys.left, right: keys.right, jump, jumpPressed: jump && jumpEdge };
  jumpEdge = false;
  return input;
}

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', 'ArrowDown'].includes(k)) e.preventDefault();
  audio.ensure();
  audio.resume();

  if (k === 'm' || k === 'M') toggleMute();
  if (k === 'Escape') {
    if (state === 'play') pause();
    else if (state === 'paused') resume();
    return;
  }

  if (state === 'title') {
    if (k === 'Enter' || k === ' ') startLevel(Math.min(progress.unlocked, LEVELS.length - 1));
    if (k === 'l' || k === 'L') showSelect();
    return;
  }
  if (state === 'select') {
    if (k === 'Escape' || k === 'Enter') showTitle();
    return;
  }
  if (state === 'complete') {
    if (k === 'Enter' || k === ' ') nextLevel();
    if (k === 'r' || k === 'R') startLevel(levelIndex);
    if (k === 'Escape') showSelect();
    return;
  }
  if (state === 'play') {
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
    if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
      if (!keys.jump) jumpEdge = true;
      keys.jump = true;
    }
    if (k === 'r' || k === 'R') {
      world.echoNow();
      audio.echo();
      renderer.burst(world.player.x + 8, world.player.y + 12, 14, { color: PALETTES[world.level.palette].ghost, speed: 70, life: 0.5 });
    }
  }
});

window.addEventListener('keyup', (e) => {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
  if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') keys.jump = false;
});

window.addEventListener('blur', () => {
  keys.left = keys.right = keys.jump = false;
});

/* ------------------------------------------------------------------- flow */

function toggleMute() {
  muted = !muted;
  localStorage.setItem('afterimage.muted', muted ? '1' : '0');
  audio.ensure();
  audio.setMuted(muted);
}

function showPanel(html) {
  panel.innerHTML = html;
  screenEl.classList.remove('gone');
  panel.classList.remove('rise');
  void panel.offsetWidth;
}

function hidePanel() {
  screenEl.classList.add('gone');
}

function showTitle() {
  state = 'title';
  hud.classList.add('hidden');
  hintEl.classList.add('hidden');
  world = null;
  renderer.setLevel({ ...LEVELS[Math.min(progress.unlocked, LEVELS.length - 1)], palette: 0, w: 32, h: 18, mapRows: emptyRows() });
  startAttract();
  showPanel(`
    <div class="eyebrow">a puzzle platformer · six rooms</div>
    <h1 class="title">AFTERIMAGE</h1>
    <p class="subtitle">You cannot make the jump. Your past self can.<br>
    Abandon a run and a piece of you stays exactly where you stopped — in the air, on a switch, over a pit.</p>
    <menu>
      <button class="primary" data-action="play">Begin</button>
      <button data-action="select">Level select</button>
    </menu>
    <div class="meta">Enter to begin · M mutes · one mechanic, no tutorials</div>
  `);
}

/* an attract loop: the finished game playing itself behind the title */
let attract = null;

function startAttract() {
  attract = { i: 0, world: new World(LEVELS[0]), auto: new AutoPlayer(SOLUTIONS[0].attempts), idle: 0 };
  renderer.setLevel(attract.world.level);
  renderer.particles.length = 0;
  world = attract.world;
}

function stepAttract() {
  if (!attract) return;
  const w = attract.world;
  const input = attract.auto.next();
  if (input && input.endAttempt) w.echoNow();
  else if (input) {
    const ev = w.step(input);
    handleEvents(ev);
  }
  if (w.state !== 'play' || attract.auto.a >= attract.auto.attempts.length) {
    attract.idle++;
    if (attract.idle > 70) {
      attract.i = (attract.i + 1) % LEVELS.length;
      attract.world = new World(LEVELS[attract.i]);
      attract.auto = new AutoPlayer(SOLUTIONS[attract.i].attempts);
      attract.idle = 0;
      renderer.setLevel(attract.world.level);
      renderer.particles.length = 0;
      world = attract.world;
    }
  }
  renderer.updateParticles(STEP);
}

function emptyRows() {
  return Array.from({ length: 18 }, () => '.'.repeat(32));
}

function showSelect() {
  state = 'select';
  hud.classList.add('hidden');
  hintEl.classList.add('hidden');
  const cards = LEVELS.map((lv, i) => {
    const locked = i > progress.unlocked;
    const best = progress.best[i];
    const medal = best ? (best.echoes <= lv.par ? 'gold' : best.echoes <= lv.par + 1 ? 'silver' : 'clear') : '—';
    return `<div class="card ${locked ? 'locked' : ''}" data-action="${locked ? '' : 'level'}" data-level="${i}">
      <div class="n">${String(i + 1).padStart(2, '0')}</div>
      <div class="t">${lv.name}</div>
      <div class="m">${locked ? 'locked' : medal}</div>
    </div>`;
  }).join('');
  showPanel(`
    <div class="eyebrow">select a room</div>
    <div class="grid">${cards}</div>
    <div class="meta">Esc returns · gold means you solved it in par</div>
  `);
}

function startLevel(i) {
  levelIndex = Math.min(i, LEVELS.length - 1);
  audio.ensure();
  audio.resume();
  audio.setChapter(LEVELS[levelIndex].palette);
  world = new World(LEVELS[levelIndex]);
  renderer.setLevel(world.level);
  renderer.particles.length = 0;
  accumulator = 0;
  hintTimer = 4.5;
  state = 'play';
  hidePanel();
  hud.classList.remove('hidden');
  hintEl.textContent = world.level.hint;
  hintEl.classList.remove('hidden');
  updateHud();
}

function pause() {
  state = 'paused';
  showPanel(`
    <div class="eyebrow">paused</div>
    <h2 class="title" style="font-size:26px;letter-spacing:.22em">PAUSED</h2>
    <menu>
      <button class="primary" data-action="resume">Resume</button>
      <button data-action="retry">Restart room</button>
      <button data-action="select">Level select</button>
    </menu>
  `);
}

function resume() {
  state = 'play';
  hidePanel();
}

function nextLevel() {
  if (levelIndex + 1 < LEVELS.length) startLevel(levelIndex + 1);
  else showSelect();
}

function complete() {
  state = 'complete';
  const echoes = world.echoes.length;
  const par = world.level.par;
  const gold = echoes <= par;
  const prev = progress.best[levelIndex];
  if (!prev || echoes < prev.echoes || (echoes === prev.echoes && world.levelTime < prev.time)) {
    progress.best[levelIndex] = { echoes, time: world.levelTime };
  }
  progress.unlocked = Math.max(progress.unlocked, Math.min(levelIndex + 1, LEVELS.length - 1));
  save();
  const medal = gold ? 'GOLD' : echoes <= par + 1 ? 'SILVER' : 'CLEARED';
  const last = levelIndex + 1 >= LEVELS.length;
  if (last) {
    const total = Object.values(progress.best).reduce((a, b) => a + (b.echoes ?? 0), 0);
    showPanel(`
      <div class="eyebrow">all six rooms · ${medal}</div>
      <h2 class="title" style="font-size:clamp(22px,3.4vw,38px);letter-spacing:.24em">YOU WERE<br>THE WAY THROUGH</h2>
      <p class="subtitle">Six rooms. ${total} echoes left standing.<br>
      Every one of them was you, doing the one thing you could not do at the time.</p>
      <menu>
        <button class="primary" data-action="select">Level select</button>
        <button data-action="retry">Play this room again</button>
      </menu>
      <div class="meta">made alone, in one month, for OpenGame Game Jam #1</div>
    `);
    return;
  }
  showPanel(`
    <div class="eyebrow">room ${String(levelIndex + 1).padStart(2, '0')} · ${medal}</div>
    <h2 class="title" style="font-size:clamp(22px,3.4vw,38px);letter-spacing:.24em">${gold ? 'PERFECT' : 'CLEARED'}</h2>
    <p class="subtitle">${world.level.name} · ${echoes} echo${echoes === 1 ? '' : 'es'} used (par ${par}) · ${fmtTime(world.levelTime)}</p>
    <menu>
      <button class="primary" data-action="next">${last ? 'Finish' : 'Next room'}</button>
      <button data-action="retry">Again for gold</button>
      <button data-action="select">Level select</button>
    </menu>
  `);
}

/* ------------------------------------------------------------------- hud */

const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t * 10) % 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
};

function updateHud() {
  $('hud-num').textContent = String(levelIndex + 1).padStart(2, '0');
  $('hud-name').textContent = world.level.name;
  const dots = [];
  for (let i = 0; i < world.level.maxEchoes; i++) dots.push(`<i class="${i < world.echoes.length ? 'on' : ''}"></i>`);
  $('hud-echoes').innerHTML = dots.join('');
  $('hud-time').textContent = fmtTime(world.levelTime);
}

/* ------------------------------------------------------------------ click */

panel.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  audio.ensure();
  audio.ui();
  if (action === 'play') startLevel(Math.min(progress.unlocked, LEVELS.length - 1));
  else if (action === 'select') showSelect();
  else if (action === 'level') startLevel(Number(el.dataset.level));
  else if (action === 'resume') resume();
  else if (action === 'retry') startLevel(levelIndex);
  else if (action === 'next') nextLevel();
});

/* ------------------------------------------------------------------- loop */

function handleEvents(events) {
  const pal = PALETTES[world.level.palette];
  for (const ev of events) {
    if (ev.type === 'jump') {
      audio.jump();
      renderer.burst(ev.x, ev.y, 6, { color: pal.accent2, speed: 60, angle: Math.PI / 2, spread: 1.4, life: 0.3, grav: 120 });
    } else if (ev.type === 'land') {
      audio.land(ev.power);
      renderer.burst(ev.x, ev.y, 8, { color: pal.text, speed: 70 + ev.power * 60, angle: -Math.PI / 2, spread: 2.2, life: 0.35, grav: 300 });
      renderer.shake = Math.max(renderer.shake, ev.power * 2.2);
    } else if (ev.type === 'die') {
      audio.death();
      renderer.shake = 7;
      renderer.flash = 0.5;
      renderer.burst(ev.x + 8, ev.y + 12, 26, { color: pal.accent, speed: 190, life: 0.55, grav: 420 });
    } else if (ev.type === 'echo') {
      audio.echo();
      renderer.burst(ev.x * 32 + 16, ev.y * 32 + 16, 18, { color: pal.ghost, speed: 60, life: 0.6, grav: -30 });
    } else if (ev.type === 'won') {
      audio.win();
      renderer.burst(ev.x + 8, ev.y + 12, 30, { color: pal.accent2, speed: 150, life: 0.8, grav: -60 });
    }
  }
}

function stepWorld(input) {
  const events = world.step(input);
  if (events.length) handleEvents(events);
  renderer.updateParticles(STEP);
  if (world.state === 'won') {
    setTimeout(() => {
      if (world && world.state === 'won') complete();
    }, 620);
    state = 'won-wait';
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  audio.tick();
  if (loopDisabled) {
    requestAnimationFrame(frame);
    return;
  }

  if (state === 'title' && attract) {
    accumulator += dt;
    let n = 0;
    while (accumulator >= STEP && n < 4) { stepAttract(); accumulator -= STEP; n++; }
  }

  if (state === 'play') {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 6) {
      const input = auto ? auto.next() : readInput();
      if (input && input.endAttempt) {
        world.echoNow();
      } else if (input) {
        stepWorld(input);
      }
      accumulator -= STEP;
      steps++;
      if (state !== 'play') break;
    }
    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) hintEl.classList.add('hidden');
    }
    if (world) updateHud();
  } else if (world && world.state === 'won' && state === 'won-wait') {
    renderer.updateParticles(dt);
  }

  if (world) renderer.draw(world, dt);
  else renderer.draw({ level: { mapRows: emptyRows(), w: 32, h: 18, goal: { x: -99, y: -99, w: 1, h: 1 }, plates: [], doors: [], objects: [] }, player: { x: -99, y: -99, w: 16, h: 24, squash: 0, facing: 1, onGround: false }, echoes: [], state: 'idle', doorProgress: 0, levelTime: 0 }, dt);

  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ debug */

class AutoPlayer {
  constructor(attempts) {
    this.attempts = attempts;
    this.a = 0;
    this.s = 0;
    this.f = 0;
    this.prevJump = false;
  }
  next() {
    if (this.a >= this.attempts.length) return null;
    const attempt = this.attempts[this.a];
    if (this.s >= attempt.length) {
      this.a++;
      this.s = 0;
      this.f = 0;
      this.prevJump = false;
      return { endAttempt: true };
    }
    const [keysStr, dur] = attempt[this.s];
    const jump = keysStr.includes('J');
    const input = {
      left: keysStr.includes('L'),
      right: keysStr.includes('R'),
      jump,
      jumpPressed: jump && !this.prevJump,
    };
    this.prevJump = jump;
    this.f++;
    if (this.f >= dur) {
      this.f = 0;
      this.s++;
    }
    return input;
  }
}

window.__SOLUTIONS = SOLUTIONS;

window.__afterimage = {
  version: '1.0',
  loadLevel(i) {
    startLevel(i);
    return { name: world.level.name, par: world.level.par, maxEchoes: world.level.maxEchoes };
  },
  setAuto(attempts) {
    auto = attempts ? new AutoPlayer(attempts) : null;
  },
  /** advance exactly n physics steps and redraw once (used by the recorder) */
  stepFrames(n = 1) {
    for (let i = 0; i < n; i++) {
      if (state !== 'play') break;
      const input = auto ? auto.next() : { left: false, right: false, jump: false, jumpPressed: false };
      if (input && input.endAttempt) world.echoNow();
      else if (input) stepWorld(input);
      if (world.state === 'won' && state === 'play') {
        state = 'won-wait';
        setTimeout(() => complete(), 620);
      }
    }
    if (world) {
      renderer.draw(world, STEP);
      updateHud();
    }
    return this.state();
  },
  state() {
    return {
      state,
      level: levelIndex,
      name: world ? world.level.name : null,
      player: world ? { x: world.player.x, y: world.player.y, onGround: world.player.onGround } : null,
      echoes: world ? world.echoes.map((e) => [e.tx, e.ty]) : [],
      frames: world ? world.frames.length : 0,
      time: world ? world.levelTime : 0,
      won: world ? world.state === 'won' : false,
    };
  },
  /** headless timing: simulate without drawing */
  bench(steps = 1200) {
    const w = new World(LEVELS[Math.max(0, levelIndex)]);
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) w.step({ left: i % 90 < 45, right: i % 90 >= 45, jump: i % 40 < 8, jumpPressed: i % 40 === 0 });
    const t1 = performance.now();
    return { steps, msTotal: +(t1 - t0).toFixed(2), msPerStep: +((t1 - t0) / steps).toFixed(4) };
  },
  drawBench(frames = 120) {
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) renderer.draw(world, STEP);
    const t1 = performance.now();
    return { frames, msPerFrame: +((t1 - t0) / frames).toFixed(2) };
  },
  unlockAll() {
    progress.unlocked = LEVELS.length - 1;
    save();
  },
  setLoop(on) {
    loopDisabled = !on;
  },
  cinema(on = true) {
    document.body.classList.toggle('cinema', on);
  },
  showFinale() {
    levelIndex = LEVELS.length - 1;
    const w = new World(LEVELS[levelIndex]);
    w.echoes = Array.from({ length: w.level.par }, (_, i) => {
      const e = new Echo([[32, 32], [32, 32], [32, 32], [32, 32]], { x: 3 + i, y: 4 });
      e.reveal = 1;
      return e;
    });
    w.state = 'won';
    w.levelTime = 9.4;
    world = w;
    renderer.setLevel(w.level);
    complete();
  },
  finishLevel() {
    if (world) {
      world.echoes = Array.from({ length: world.level.par }, (_, i) => {
        const e = new Echo([[32, 32], [32, 32], [32, 32], [32, 32]], { x: 3 + i, y: 4 });
        e.reveal = 1;
        return e;
      });
      world.state = 'won';
      complete();
    }
  },
};

/* ------------------------------------------------------------------- boot */

audio.setMuted(muted);
showTitle();
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});
