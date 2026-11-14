/**
 * 冰火小冒险 —— 游戏引擎
 * 物理、关卡解析、移动平台、机关、粒子、渲染(可爱画风)
 */
(function (root) {
  const FWF = root.FWF = root.FWF || {};
  const TILE = 32;

  const GRAV = 1500, JUMP = 550, MOVE = 245;
  const ACC_G = 2600, FRIC_G = 2800, ACC_A = 1500, FRIC_A = 380;
  const MAXFALL = 900, COYOTE = 0.09, BOUNCE_V = 820;
  const PW = 20, PH = 24;
  const DOOR_GRACE = 1.6;

  const SOLID_TILES = new Set(['#']);
  const TRACK_BOUNDS = new Set(['#', 'A', 'B', 'C', 'D']);
  const DEADLY_FIRE = new Set(['~', 'P', '^']);
  const DEADLY_WATER = new Set(['L', 'P', '^']);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------------- 关卡解析 ---------------- */
  function parseLevel(def) {
    const map = def.map;
    const H = map.length, W = map[0].length;
    const tiles = map.map((r) => r.split(''));
    const spawns = { fire: null, water: null };
    const exits = { fire: null, water: null };
    const gems = [];
    const buttons = {};   // code -> {x, y, on}
    const doors = {};     // code -> {x, y, grace}
    const pads = [];
    const platDefs = [];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = tiles[y][x];
        if (c === 'F') spawns.fire = { x: x, y: y };
        else if (c === 'W') spawns.water = { x: x, y: y };
        else if (c === 'X') exits.fire = { x: x, y: y };
        else if (c === 'Y') exits.water = { x: x, y: y };
        else if (c === '*') gems.push({ id: gems.length, x: x, y: y, taken: false });
        else if (c >= 'a' && c <= 'd') buttons[c] = { x: x, y: y, on: false };
        else if (c >= 'A' && c <= 'D') doors[c] = { x: x, y: y, grace: 0 };
        else if (c === '=') pads.push({ x: x, y: y, t: 0 });
        else if (c === '-') platDefs.push({ dir: 'h', x: x, y: y });
        else if (c === '|') platDefs.push({ dir: 'v', x: x, y: y });
      }
    }

    const plats = platDefs.map((pd) => {
      const speed = (pd.dir === 'h' ? 55 : 42) * (def.opts && def.opts.plats ? def.opts.plats : 1);
      if (pd.dir === 'h') {
        let l = pd.x, r = pd.x;
        while (l > 0 && !TRACK_BOUNDS.has(tiles[pd.y][l - 1])) l--;
        while (r < W - 1 && !TRACK_BOUNDS.has(tiles[pd.y][r + 1])) r++;
        l = Math.max(0, l); r = Math.min(W - 1, r);
        return { dir: 'h', lo: l, hi: r, x: pd.x, y: pd.y, speed, phase: ((pd.x * 7 + pd.y * 13) % 10) / 10 };
      } else {
        let u = pd.y, d = pd.y;
        while (u > 0 && !TRACK_BOUNDS.has(tiles[u - 1][pd.x])) u--;
        while (d < H - 1 && !TRACK_BOUNDS.has(tiles[d + 1][pd.x])) d++;
        let top, bottom;
        if (u > 0) top = Math.min(H - 1, u + 1); else top = 1;   // 顶部留一格的头顶空间
        bottom = Math.min(H - 1, d);
        const lo = Math.min(top, bottom), hi = Math.max(top, bottom);
        return { dir: 'v', lo: lo, hi: hi, x: pd.x, y: pd.y, speed, phase: ((pd.x * 7 + pd.y * 13) % 10) / 10 };
      }
    });

    // 防御:出生点缺失时给个兜底位置
    if (!spawns.fire) spawns.fire = { x: 0, y: 0 };
    if (!spawns.water) spawns.water = { x: Math.min(1, W - 1), y: 0 };

    return { tiles, W, H, spawns, exits, gems, buttons, doors, pads, plats };
  }

  /* ---------------- 粒子 ---------------- */
  function addParticles(parts, x, y, opts) {
    for (let i = 0; i < (opts.n || 8); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed || 80) * (0.4 + Math.random() * 0.9);
      parts.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (opts.up || 40),
        life: opts.life || 0.5,
        maxLife: opts.life || 0.5,
        size: (opts.size || 4) * (0.6 + Math.random() * 0.8),
        color: opts.colors ? opts.colors[i % opts.colors.length] : '#ffffff',
        type: opts.type || 'puff',
        grav: opts.grav !== undefined ? opts.grav : 300,
        rot: Math.random() * 6.3,
        vr: (Math.random() - 0.5) * 8
      });
    }
  }
  function updateParticles(parts, dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      p.rot += p.vr * dt;
      if (p.type === 'puff') p.vx *= 0.96;
    }
  }

  /* ---------------- 玩家 ---------------- */
  class Player {
    constructor(role, spawn) {
      this.role = role;
      this.w = PW; this.h = PH;
      this.x = spawn.x * TILE + (TILE - PW) / 2;
      this.y = spawn.y * TILE + (TILE - PH);
      this.spawnX = this.x; this.spawnY = this.y;
      this.vx = 0; this.vy = 0;
      this.dir = 1;
      this.onGround = false;
      this.coyote = 0;
      this.dead = false;
      this.deathTimer = 0;
      this.deaths = 0;
      this.finished = false;
      this.squash = 1; this.stretch = 1;
      this.blink = 0; this.blinkTimer = 2 + Math.random() * 3;
      this.bob = Math.random() * 6.3;
      this.standingOn = null;
      this.landT = 0;
    }
    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
  }

  /* ---------------- 游戏主体 ---------------- */
  class Game {
    /**
     * opts: { level, mode:'solo'|'online', role:'fire'|'water', t0, net,
     *         onComplete, onHud, onToast, levelDef }
     */
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts || {};
      this.mode = this.opts.mode || 'solo';
      this.role = this.opts.role || 'fire';
      this.net = this.opts.net || null;
      this.levelNum = this.opts.level;
      this.def = this.opts.levelDef;
      this.t0 = this.opts.t0 || (Date.now() + 2200);
      this.paused = false;
      this.completed = false;
      this.destroyed = false;

      this.time = 0;             // 关卡内时钟(秒, 从 t0 起)
      this.parts = [];
      this.gemsTaken = 0;
      this.hudT = 0;
      this.netT = 0;
      this.completeT = 0;
      this.peerBuffer = [];
      this.remote = { x: 0, y: 0, dir: 1, dead: false, finished: false, active: false, prevDead: false };
      this.remoteGone = false;
      this.hintShown = 0;
      this.controlMode = (this.mode === 'online')
        ? 'online'
        : (('ontouchstart' in root) ? 'solo' : 'dual');

      this.load(this.def);
      this._resize();
    }

    load(def) {
      const L = parseLevel(def);
      this.L = L;
      this.fire = new Player('fire', L.spawns.fire);
      this.water = new Player('water', L.spawns.water);
      this.remote.active = false;
      this.remote.dead = false;
      this.remote.finished = false;
      this.remote.prevDead = false;
      this.peerBuffer = [];
      this.gemsTaken = 0;
      this.completeT = 0;
      this.completed = false;
      this.parts.length = 0;
      this.time = 0;
      // 平台初始位置
      for (const p of this.L.plats) {
        p.pos = p.lo;
        p.px = p.dir === 'h' ? p.pos : p.x;
        p.py = p.dir === 'h' ? p.y : p.pos;
        p.dx = 0; p.dy = 0;
      }
    }

    _resize() {
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      const w = this.canvas.clientWidth || root.innerWidth;
      const h = this.canvas.clientHeight || root.innerHeight;
      this.vw = w; this.vh = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.dpr = dpr;
    }

    /* ---------- 主循环 ---------- */
    frame = (now) => {
      if (this.destroyed) return;
      const clock = this.now();
      if (this.opts.onFrame) this.opts.onFrame(clock, this);
      if (!this.paused && clock >= this.t0) {
        let dt = this._lastNow === undefined ? 1 / 60 : Math.min(1 / 30, (clock - this._lastNow) / 1000);
        if (dt <= 0) dt = 1 / 60;
        this._lastNow = clock;
        const steps = dt > 1 / 55 ? 2 : 1;
        const sdt = dt / steps;
        for (let i = 0; i < steps; i++) this.step(sdt);
      } else if (clock >= this.t0) {
        this._lastNow = clock;
      }
      this.render();
      this._raf = requestAnimationFrame(this.frame);
    };

    now() {
      return this.net && this.net.connected
        ? Date.now() + this.net.clockOffset
        : Date.now();
    }

    start() {
      this._lastNow = undefined;
      this._raf = requestAnimationFrame(this.frame);
    }
    destroy() {
      this.destroyed = true;
      if (this._raf) cancelAnimationFrame(this._raf);
    }
    pause() { this.paused = true; }
    resume() { this.paused = false; this._lastNow = undefined; }

    setPeerGone() {
      this.remoteGone = true;
      this.remote.active = false;
      this.controlMode = ('ontouchstart' in root) ? 'solo' : 'dual';
      FWF.input.setMode(this.controlMode);
      if (this.opts.onToast) this.opts.onToast('小伙伴掉线了,现在你可以控制两个角色啦!');
    }

    /* ---------- 网络 ---------- */
    pushPeerState(s) {
      this.peerBuffer.push({ t: this.time, x: s.x, y: s.y, dir: s.dir, dead: s.dead, finished: s.finished });
      if (this.peerBuffer.length > 8) this.peerBuffer.shift();
      const r = this.remote;
      if (!r.active) { r.active = true; r.x = s.x; r.y = s.y; }
      if (s.dead && !r.prevDead) {
        addParticles(this.parts, s.x + PW / 2, s.y + PH / 2, { n: 10, colors: [this.role === 'fire' ? '#6fc7ff' : '#ff8a5c', '#ffffff'], type: 'puff' });
        FWF.audio.sfx('death');
      }
      r.prevDead = s.dead;
    }

    applyPeerEvent(e) {
      if (!e || !e.kind) return;
      if (e.kind === 'gem' && this.L.gems[e.id]) {
        this.L.gems[e.id].taken = true;
        this.gemsTaken++;
        const g = this.L.gems[e.id];
        addParticles(this.parts, g.x * TILE + TILE / 2, g.y * TILE + TILE / 2, { n: 8, colors: ['#ffd94d', '#fff3b0'], type: 'spark', grav: 60 });
        FWF.audio.sfx('collect');
      }
    }

    getMyState() {
      const p = this.role === 'fire' ? this.fire : this.water;
      return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, dir: p.dir, dead: p.dead, finished: p.finished };
    }

    /* ---------- 物理 ---------- */
    step(dt) {
      this.time += dt;

      // 平台移动
      for (const p of this.L.plats) {
        const span = p.hi - p.lo;
        const oneWay = span * TILE / p.speed;
        const u = (this.time / oneWay + p.phase) % 2;
        const pos = u < 1 ? p.lo + u * span : p.lo + (2 - u) * span;
        p.pos = pos;
        if (p.dir === 'h') {
          p.dx = (pos - p.px) * TILE;
          p.dy = 0;
          p.px = pos;
        } else {
          p.dx = 0;
          p.dy = (pos - p.py) * TILE;
          p.py = pos;
        }
      }

      // 平台携带
      for (const pl of this.localPlayers()) {
        if (pl.dead || pl.finished) continue;
        if (pl.standingOn) {
          const p = pl.standingOn;
          pl.x += p.dx;
          pl.y += p.dy;
          pl.standingOn = null;
        }
      }

      // 玩家移动
      const inp = this.inputFor(this.fire);
      this.stepPlayer(this.fire, dt, inp);
      const inpW = this.inputFor(this.water);
      this.stepPlayer(this.water, dt, inpW);

      // 机关
      this.stepMechanics(dt);
      // 粒子
      updateParticles(this.parts, dt);
      // 蹦床动画
      for (const pd of this.L.pads) pd.t = Math.max(0, pd.t - dt);

      // HUD 与网络发送
      this.hudT -= dt;
      if (this.hudT <= 0) {
        this.hudT = 0.15;
        if (this.opts.onHud) {
          this.opts.onHud({
            gems: this.gemsTaken, gemTotal: this.L.gems.length,
            deaths: this.fire.deaths + this.water.deaths,
            finished: this.bothFinished()
          });
        }
      }
      this.netT -= dt;
      if (this.net && this.net.connected && this.mode === 'online' && this.netT <= 0) {
        this.netT = 0.05;
        this.net.sendState(this.getMyState());
      }

      // 过关判定
      if (!this.completed && this.bothFinished()) {
        this.completed = true;
        this.completeT = 0.9;
        addParticles(this.parts, this.L.exits.fire.x * TILE + 16, this.L.exits.fire.y * TILE + 16, { n: 20, colors: ['#ffd94d', '#ff9d6c', '#7fd7ff', '#ffffff'], type: 'heart', grav: -40, life: 1.2 });
      }
      if (this.completed) {
        this.completeT -= dt;
        if (this.completeT <= 0 && this.opts.onComplete) {
          this.opts.onComplete({
            gems: this.gemsTaken, gemTotal: this.L.gems.length,
            deaths: this.fire.deaths + this.water.deaths
          });
          this.completeT = Infinity; // 只触发一次
        }
      }
    }

    localPlayers() {
      if (this.mode === 'online' && !this.remoteGone) {
        return this.role === 'fire' ? [this.fire] : [this.water];
      }
      return [this.fire, this.water];
    }

    inputFor(pl) {
      const I = FWF.input;
      if (this.controlMode === 'online') {
        return pl.role === this.role ? I[this.role] : null;
      }
      if (this.controlMode === 'solo') {
        return pl.role === I.active ? I[pl.role] : null;
      }
      return I[pl.role];
    }

    stepPlayer(p, dt, inp) {
      if (!inp) inp = { left: false, right: false, jumpBuf: 0, jumpHeld: false };
      if (p.dead) {
        p.deathTimer -= dt;
        if (p.deathTimer <= 0) {
          p.dead = false;
          p.x = p.spawnX; p.y = p.spawnY;
          p.vx = 0; p.vy = 0;
          p.onGround = false;
          addParticles(this.parts, p.cx, p.cy, { n: 10, colors: p.role === 'fire' ? ['#ffb37a', '#ffffff'] : ['#8fd8ff', '#ffffff'], type: 'spark', grav: -30 });
        }
        return;
      }
      if (p.finished) return;

      const acc = p.onGround ? ACC_G : ACC_A;
      const fric = p.onGround ? FRIC_G : FRIC_A;
      const target = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      if (target !== 0) {
        p.vx += target * acc * dt;
        p.dir = target;
      } else {
        const s = Math.sign(p.vx);
        const f = fric * dt;
        if (Math.abs(p.vx) <= f) p.vx = 0; else p.vx -= s * f;
      }
      p.vx = clamp(p.vx, -MOVE, MOVE);

      p.coyote = p.onGround ? COYOTE : Math.max(0, p.coyote - dt);
      if (!inp.jumpHeld) p.jumpHeldConsumed = false;
      let wantJump = inp.jumpBuf > 0;
      if (!wantJump && inp.jumpHeld && !p.jumpHeldConsumed) wantJump = true;
      if (wantJump && p.coyote > 0) {
        p.vy = -JUMP;
        p.coyote = 0;
        p.onGround = false;
        p.stretch = 1.22;
        p.jumpHeldConsumed = inp.jumpHeld;
        inp.jumpBuf = 0;
        FWF.audio.sfx('jump');
        addParticles(this.parts, p.cx, p.y + p.h, { n: 5, colors: ['#ffffff', '#e8e8e8'], type: 'puff', grav: -60, up: 20 });
      }

      p.vy = Math.min(p.vy + GRAV * dt, MAXFALL);

      // X 移动与碰撞
      p.x += p.vx * dt;
      this.resolveX(p);
      // Y 移动与碰撞
      const prevVy = p.vy;
      p.y += p.vy * dt;
      const wasGround = p.onGround;
      p.onGround = false;
      this.resolveY(p);
      if (p.onGround && !wasGround && prevVy > 350) {
        p.squash = 0.72;
        p.landT = 0.12;
        FWF.audio.sfx('land');
      }

      // 弹性动画衰减
      p.squash += (1 - p.squash) * Math.min(1, dt * 10);
      p.stretch += (1 - p.stretch) * Math.min(1, dt * 8);
      p.landT = Math.max(0, p.landT - dt);
      p.blinkTimer -= dt;
      if (p.blinkTimer <= 0) { p.blink = 0.12; p.blinkTimer = 2 + Math.random() * 3.5; }
      p.blink = Math.max(0, p.blink - dt);
      p.bob += dt * 6;

      // 掉出地图
      if (p.y > this.L.H * TILE + 60) this.kill(p);

      this.touchHazards(p);
      this.touchPads(p);
      this.touchGems(p);
      this.touchExit(p);
    }

    solidsNear(p) {
      const out = [];
      const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + p.w - 1) / TILE);
      const y0 = Math.floor(p.y / TILE), y1 = Math.floor((p.y + p.h - 1) / TILE);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const solid = this.tileSolid(tx, ty);
          if (solid) out.push({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE });
        }
      }
      for (const pfm of this.L.plats) {
        const px = pfm.dir === 'h' ? pfm.px * TILE : pfm.x * TILE;
        const py = pfm.dir === 'h' ? pfm.y * TILE : pfm.py * TILE;
        out.push({ x: px, y: py, w: TILE, h: TILE, plat: pfm });
      }
      return out;
    }

    tileSolid(tx, ty) {
      if (tx < 0 || tx >= this.L.W) return true;      // 左右是墙
      if (ty >= this.L.H) return true;                 // 底部是墙(但掉下去之前会死)
      if (ty < 0) return false;                        // 顶部开放
      const c = this.L.tiles[ty][tx];
      if (SOLID_TILES.has(c)) return true;
      if (c >= 'A' && c <= 'D') {
        const door = this.L.doors[c];
        return !door || door.grace <= 0 && !(this.L.buttons[c.toLowerCase()] && this.L.buttons[c.toLowerCase()].on);
      }
      return false;
    }

    resolveX(p) {
      for (const s of this.solidsNear(p)) {
        if (p.x + p.w <= s.x || p.x >= s.x + s.w) continue;
        if (p.y + p.h <= s.y || p.y >= s.y + s.h) continue;
        if (p.vx > 0) p.x = s.x - p.w;
        else if (p.vx < 0) p.x = s.x + s.w;
        else p.x = p.cx < s.x + s.w / 2 ? s.x - p.w : s.x + s.w;
        p.vx = 0;
      }
    }

    resolveY(p) {
      for (const s of this.solidsNear(p)) {
        if (p.x + p.w <= s.x || p.x >= s.x + s.w) continue;
        if (p.y + p.h <= s.y || p.y >= s.y + s.h) continue;
        if (p.vy >= 0) {
          p.y = s.y - p.h;
          p.vy = 0;
          p.onGround = true;
          if (s.plat) p.standingOn = s.plat;
        } else {
          p.y = s.y + s.h;
          p.vy = 0;
        }
      }
    }

    kill(p) {
      if (p.dead || p.finished) return;
      p.dead = true;
      p.deathTimer = 0.85;
      p.deaths++;
      p.vy = 0; p.vx = 0;
      FWF.audio.sfx('death');
      addParticles(this.parts, p.cx, p.cy, { n: 14, colors: p.role === 'fire' ? ['#ff8a5c', '#ffd2b8', '#ffffff'] : ['#6fc7ff', '#c9e9ff', '#ffffff'], type: 'puff' });
      if (this.net && this.net.connected && this.mode === 'online') {
        this.net.sendEvent({ kind: 'death' });
      }
    }

    touchHazards(p) {
      if (p.dead || p.finished) return;
      const inset = 6;
      const x0 = Math.floor((p.x + inset) / TILE), x1 = Math.floor((p.x + p.w - inset - 1) / TILE);
      const y0 = Math.floor((p.y + inset) / TILE), y1 = Math.floor((p.y + p.h - inset - 1) / TILE);
      const deadly = p.role === 'fire' ? DEADLY_FIRE : DEADLY_WATER;
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (tx < 0 || tx >= this.L.W || ty < 0 || ty >= this.L.H) continue;
          const c = this.L.tiles[ty][tx];
          if (deadly.has(c)) { this.kill(p); return; }
        }
      }
    }

    touchPads(p) {
      if (p.dead || p.finished) return;
      for (const pd of this.L.pads) {
        const top = pd.y * TILE;
        if (p.x + p.w > pd.x * TILE + 4 && p.x < (pd.x + 1) * TILE - 4 &&
            p.y + p.h >= top && p.y + p.h <= top + 40) {
          p.vy = -BOUNCE_V;
          p.onGround = false;
          p.stretch = 1.35;
          pd.t = 0.35;
          FWF.audio.sfx('bounce');
          addParticles(this.parts, p.cx, top, { n: 8, colors: ['#ffd94d', '#ffffff'], type: 'puff', grav: -100, up: 60 });
          return;
        }
      }
    }

    touchGems(p) {
      if (p.dead || p.finished) return;
      for (const g of this.L.gems) {
        if (g.taken) continue;
        const gx = g.x * TILE + TILE / 2, gy = g.y * TILE + TILE / 2;
        if (Math.abs(p.cx - gx) < 15 && Math.abs(p.cy - gy) < 15) {
          g.taken = true;
          this.gemsTaken++;
          FWF.audio.sfx('collect');
          addParticles(this.parts, gx, gy, { n: 8, colors: ['#ffd94d', '#fff3b0'], type: 'spark', grav: 60 });
          if (this.net && this.net.connected && this.mode === 'online') {
            this.net.sendEvent({ kind: 'gem', id: g.id });
          }
        }
      }
    }

    touchExit(p) {
      if (p.dead || p.finished) return;
      const ex = this.L.exits[p.role];
      if (!ex) return;
      const x = ex.x * TILE, y = ex.y * TILE;
      if (p.x + p.w > x + 3 && p.x < x + TILE - 3 && p.y + p.h > y + 10 && p.y < y + TILE - 2) {
        p.finished = true;
        p.vx = 0; p.vy = 0;
        FWF.audio.sfx('finish');
        addParticles(this.parts, p.cx, p.cy, { n: 16, colors: p.role === 'fire' ? ['#ffb37a', '#ffd94d', '#fff'] : ['#8fd8ff', '#7fd7ff', '#fff'], type: 'heart', grav: -50, life: 1.1 });
        if (this.net && this.net.connected && this.mode === 'online') {
          this.net.sendEvent({ kind: 'finish' });
        }
      }
    }

    stepMechanics(dt) {
      // 按钮:被任一存活且未过关的角色踩住
      const chars = [];
      for (const p of [this.fire, this.water]) {
        if (!p.dead && !p.finished) chars.push(p);
      }
      const r = this.remote;
      if (this.mode === 'online' && r.active && !r.dead && !r.finished) {
        chars.push({ x: r.x, y: r.y, w: PW, h: PH });
      }
      for (const code in this.L.buttons) {
        const b = this.L.buttons[code];
        const top = b.y * TILE;
        let pressed = false;
        for (const c of chars) {
          // 脚底范围覆盖两种按钮:平台上的按钮(脚底=按钮顶)与地面上的按钮(脚底=按钮底)
          if (c.x + c.w > b.x * TILE + 6 && c.x < (b.x + 1) * TILE - 6 &&
              c.y + c.h >= top - 2 && c.y + c.h <= top + 34) {
            pressed = true;
            break;
          }
        }
        if (pressed && !b.on) {
          b.on = true;
          FWF.audio.sfx('button');
          addParticles(this.parts, b.x * TILE + 16, top, { n: 5, colors: ['#ffffff', '#ffe28a'], type: 'puff', grav: -80 });
        } else if (!pressed && b.on) {
          b.on = false;
          const door = this.L.doors[code.toUpperCase()];
          if (door) door.grace = DOOR_GRACE;
        }
      }
      // 门:宽限期衰减
      for (const code in this.L.doors) {
        const d = this.L.doors[code];
        if (d.grace > 0) d.grace = Math.max(0, d.grace - dt);
      }
    }

    bothFinished() {
      const f = this.fire.finished;
      const w = this.water.finished;
      const r = this.remote;
      if (this.mode === 'online') {
        return this.role === 'fire' ? (f && (this.remoteGone ? w : r.finished)) : (w && (this.remoteGone ? f : r.finished));
      }
      return f && w;
    }

    /* ---------- 渲染 ---------- */
    render() {
      const ctx = this.ctx;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.vw, this.vh);
      this.drawBackground(ctx);

      // 相机
      const L = this.L;
      const r = this.remote;
      const remoteDraw = (this.mode === 'online' && r.active && !this.remoteGone)
        ? { x: this.remoteRenderX(), y: this.remoteRenderY(), cx: this.remoteRenderX() + PW / 2, cy: this.remoteRenderY() + PH / 2, dir: r.dir, dead: r.dead, finished: r.finished }
        : null;
      let p1 = this.fire, p2 = this.water;
      if (remoteDraw) {
        if (this.role === 'fire') p2 = remoteDraw; else p1 = remoteDraw;
      }
      const midX = (p1.cx + p2.cx) / 2;
      const midY = (p1.cy + p2.cy) / 2;
      const fitS = Math.min(this.vw / (L.W * TILE), this.vh / (L.H * TILE));
      const spanX = Math.abs(p1.cx - p2.cx) + 5 * TILE;
      const spanY = Math.abs(p1.cy - p2.cy) + 4.5 * TILE;
      const reqS = Math.min(this.vw / spanX, this.vh / spanY);
      const minS = Math.min(this.vw / 640, this.vh / 480);
      let s = clamp(Math.min(fitS, reqS), minS, Math.max(minS, fitS));
      s = Math.max(s, minS);
      const camX = clamp(midX, this.vw / (2 * s), L.W * TILE - this.vw / (2 * s));
      const camY = clamp(midY, this.vh / (2 * s), L.H * TILE - this.vh / (2 * s));

      ctx.save();
      ctx.translate(this.vw / 2, this.vh / 2);
      ctx.scale(s, s);
      ctx.translate(-camX, -camY);

      this.drawTiles(ctx);
      this.drawGems(ctx);
      this.drawDoorsButtons(ctx);
      this.drawPads(ctx);
      this.drawPlatforms(ctx);
      this.drawExits(ctx);

      // 远端角色
      if (remoteDraw && !remoteDraw.finished) {
        this.drawChar(ctx, remoteDraw, 'remote');
      }
      // 本地角色
      for (const p of [this.fire, this.water]) {
        if (this.mode === 'online' && !this.remoteGone && p.role !== this.role) continue;
        if (!p.finished) this.drawChar(ctx, p, 'local');
      }
      this.drawParticles(ctx);
      ctx.restore();

      // 屏幕空间:HUD 提示(角色标签由 DOM 完成)
      if (this.completed) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 30px "Comic Sans MS","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('过关啦! 🎉', this.vw / 2, this.vh * 0.28);
      }
    }

    remoteRenderX() {
      const r = this.remote;
      if (this.peerBuffer.length < 2) return r.x;
      const t = this.time - 0.12;
      const b = this.peerBuffer;
      let i = 0;
      while (i < b.length - 1 && b[i + 1].t < t) i++;
      const a = b[i], c = b[Math.min(i + 1, b.length - 1)];
      const span = c.t - a.t;
      const k = span > 0 ? clamp((t - a.t) / span, 0, 1) : 0;
      return lerp(a.x, c.x, k);
    }
    remoteRenderY() {
      const r = this.remote;
      if (this.peerBuffer.length < 2) return r.y;
      const t = this.time - 0.12;
      const b = this.peerBuffer;
      let i = 0;
      while (i < b.length - 1 && b[i + 1].t < t) i++;
      const a = b[i], c = b[Math.min(i + 1, b.length - 1)];
      const span = c.t - a.t;
      const k = span > 0 ? clamp((t - a.t) / span, 0, 1) : 0;
      return lerp(a.y, c.y, k);
    }

    drawBackground(ctx) {
      const palettes = [
        ['#ffe6f1', '#ffd9e8', '#cdeffd'],
        ['#fff1dc', '#ffe4c9', '#d9f4e2']
      ];
      const pal = palettes[this.levelNum % 2];
      const g = ctx.createLinearGradient(0, 0, 0, this.vh);
      g.addColorStop(0, pal[0]);
      g.addColorStop(0.6, pal[1]);
      g.addColorStop(1, pal[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.vw, this.vh);

      // 云朵(屏幕空间缓慢漂移)
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const t = this.time;
      for (let i = 0; i < 5; i++) {
        const cw = 60 + ((i * 37 + this.levelNum * 13) % 40);
        const cx = ((i * 233 + this.levelNum * 97) % (this.vw + 260)) - 130 + Math.sin(t * 0.05 + i) * 20;
        const cy = 40 + ((i * 61) % (this.vh * 0.4));
        this.cloud(ctx, cx, cy, cw);
      }
      // 太阳
      const sx = this.vw - 90, sy = 80;
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath();
      ctx.arc(sx, sy, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,226,122,0.35)';
      ctx.beginPath();
      ctx.arc(sx, sy, 48, 0, Math.PI * 2);
      ctx.fill();
    }

    cloud(ctx, x, y, w) {
      ctx.beginPath();
      ctx.arc(x, y, w * 0.3, 0, Math.PI * 2);
      ctx.arc(x + w * 0.32, y - w * 0.16, w * 0.26, 0, Math.PI * 2);
      ctx.arc(x + w * 0.62, y, w * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }

    drawTiles(ctx) {
      const L = this.L;
      for (let ty = 0; ty < L.H; ty++) {
        for (let tx = 0; tx < L.W; tx++) {
          const c = L.tiles[ty][tx];
          const x = tx * TILE, y = ty * TILE;
          switch (c) {
            case '#': this.drawWall(ctx, tx, ty); break;
            case 'L': this.drawLava(ctx, tx, ty); break;
            case '~': this.drawWater(ctx, tx, ty); break;
            case 'P': this.drawPoison(ctx, tx, ty); break;
            case '^': this.drawSpikes(ctx, tx, ty); break;
          }
        }
      }
    }

    drawWall(ctx, tx, ty) {
      const L = this.L;
      const x = tx * TILE, y = ty * TILE;
      const above = ty - 1 >= 0 ? L.tiles[ty - 1][tx] : '.';
      const below = ty + 1 < L.H ? L.tiles[ty + 1][tx] : '#';
      const floating = below === '.' || below === 'L' || below === '~' || below === 'P' || below === '^';
      ctx.fillStyle = '#d8a470';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#c08a58';
      ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
      ctx.fillStyle = '#e8c193';
      ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
      if (above !== '#' && !(above >= 'A' && above <= 'D')) {
        // 顶部草皮
        ctx.fillStyle = '#8fd65f';
        ctx.beginPath();
        ctx.moveTo(x - 1, y + 8);
        ctx.quadraticCurveTo(x + 8, y - 2, x + 16, y + 7);
        ctx.quadraticCurveTo(x + 24, y - 3, x + 33, y + 8);
        ctx.lineTo(x + 33, y + 8);
        ctx.lineTo(x - 1, y + 8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#b2e87c';
        ctx.fillRect(x, y, TILE, 4);
      }
      if (floating) {
        ctx.fillStyle = '#c08a58';
        ctx.fillRect(x + 2, y + TILE - 5, TILE - 4, 5);
      }
    }

    drawLava(ctx, tx, ty) {
      const x = tx * TILE, y = ty * TILE;
      ctx.fillStyle = '#ff7a3d';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#ff9d5c';
      const w1 = Math.sin(this.time * 3 + tx * 1.7) * 3;
      ctx.beginPath();
      ctx.moveTo(x, y + 12 + w1);
      for (let i = 0; i <= 4; i++) {
        ctx.lineTo(x + i * 8, y + 12 + w1 + Math.sin(this.time * 4 + tx + i) * 2.5);
      }
      ctx.lineTo(x + TILE, y + 12 + w1);
      ctx.lineTo(x + TILE, y + TILE);
      ctx.lineTo(x, y + TILE);
      ctx.closePath();
      ctx.fill();
      if (Math.random() < 0.02) {
        addParticles(this.parts, x + 8 + Math.random() * 16, y + 8, { n: 1, colors: ['#ffb347'], type: 'puff', grav: -140, up: 30, life: 0.6, size: 3 });
      }
    }

    drawWater(ctx, tx, ty) {
      const x = tx * TILE, y = ty * TILE;
      ctx.fillStyle = '#59b8f0';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      const off = (this.time * 20 + tx * 8) % 32;
      ctx.beginPath();
      ctx.moveTo(x, y + 8 + Math.sin(this.time * 3 + tx) * 2);
      ctx.quadraticCurveTo(x + 8, y + 4 + Math.sin(this.time * 3 + tx + 1) * 2, x + 16, y + 8 + Math.sin(this.time * 3 + tx) * 2);
      ctx.quadraticCurveTo(x + 24, y + 12 + Math.sin(this.time * 3 + tx + 1) * 2, x + 32, y + 8 + Math.sin(this.time * 3 + tx) * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(x, y + 20 - Math.sin(this.time * 3 + tx) * 2);
      ctx.quadraticCurveTo(x + 8, y + 16 - Math.sin(this.time * 3 + tx + 1) * 2, x + 16, y + 20 - Math.sin(this.time * 3 + tx) * 2);
      ctx.quadraticCurveTo(x + 24, y + 24 - Math.sin(this.time * 3 + tx + 1) * 2, x + 32, y + 20 - Math.sin(this.time * 3 + tx) * 2);
      ctx.stroke();
    }

    drawPoison(ctx, tx, ty) {
      const x = tx * TILE, y = ty * TILE;
      ctx.fillStyle = '#8fce4f';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let i = 0; i < 3; i++) {
        const bx = x + 6 + ((i * 11 + tx * 5) % 20);
        const by = y + 20 - ((this.time * 26 + i * 13 + tx * 9) % 24);
        ctx.beginPath();
        ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawSpikes(ctx, tx, ty) {
      const x = tx * TILE, y = ty * TILE;
      ctx.fillStyle = '#9aa3b0';
      for (let i = 0; i < 4; i++) {
        const sx = x + i * 8;
        ctx.beginPath();
        ctx.moveTo(sx, y + TILE);
        ctx.lineTo(sx + 4, y + 8);
        ctx.lineTo(sx + 8, y + TILE);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#c3cad4';
      for (let i = 0; i < 4; i++) {
        const sx = x + i * 8 + 2;
        ctx.beginPath();
        ctx.moveTo(sx, y + TILE);
        ctx.lineTo(sx + 2, y + 14);
        ctx.lineTo(sx + 4, y + TILE);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawGems(ctx) {
      for (const g of this.L.gems) {
        if (g.taken) continue;
        const x = g.x * TILE + 16, y = g.y * TILE + 14 + Math.sin(this.time * 2.4 + g.x * 1.3) * 3;
        const k = Math.abs(Math.sin(this.time * 2 + g.id));
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(0.45 + k * 0.55, 1);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#ffd94d';
        ctx.strokeStyle = '#e0a93a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-9, -9, 18, 18, 4) : ctx.rect(-9, -9, 18, 18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(-6, -6, 5, 5);
        ctx.restore();
      }
    }

    drawDoorsButtons(ctx) {
      const L = this.L;
      for (const code in L.doors) {
        const d = L.doors[code];
        const btn = L.buttons[code.toLowerCase()];
        const open = btn && btn.on || d.grace > 0;
        const x = d.x * TILE, y = d.y * TILE;
        // 门框(2 格高拱门)
        ctx.fillStyle = open ? '#7fd7a0' : '#8f7a63';
        ctx.beginPath();
        ctx.moveTo(x + 2, y + TILE);
        ctx.lineTo(x + 2, y + 8);
        ctx.quadraticCurveTo(x + 2, y - 10, x + 16, y - 10);
        ctx.quadraticCurveTo(x + 30, y - 10, x + 30, y + 8);
        ctx.lineTo(x + 30, y + TILE);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = open ? '#c9f0d5' : '#a78d75';
        ctx.fillRect(x + 8, y + (open ? -2 : 6), TILE - 16, open ? TILE + 2 : TILE - 6);
        // 可爱小脸
        ctx.fillStyle = '#5b4632';
        if (open) {
          ctx.beginPath(); ctx.arc(x + 12, y + 16, 2, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + 20, y + 16, 2, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + 16, y + 22, 3, 0, Math.PI); ctx.fill();
        } else {
          ctx.fillRect(x + 10, y + 16, 3, 3);
          ctx.fillRect(x + 19, y + 16, 3, 3);
        }
      }
      for (const code in L.buttons) {
        const b = L.buttons[code];
        const x = b.x * TILE + 16, y = b.y * TILE + 22;
        ctx.fillStyle = b.on ? '#ffc93c' : '#d9a06b';
        ctx.strokeStyle = '#a76f43';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, y, 12, b.on ? 5 : 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#7a5a3a';
        if (b.on) {
          ctx.beginPath(); ctx.arc(x - 4, y - 2, 1.6, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + 4, y - 2, 1.6, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x, y + 1, 2.2, 0, Math.PI); ctx.fill();
        }
      }
    }

    drawPads(ctx) {
      for (const pd of this.L.pads) {
        const x = pd.x * TILE, y = pd.y * TILE;
        const k = pd.t > 0 ? 1 - pd.t / 0.35 : 1;
        ctx.fillStyle = '#ff9d5c';
        ctx.fillRect(x + 3, y + TILE - 8 - 6 * k, TILE - 6, 8 + 6 * k);
        ctx.fillStyle = '#ffc93c';
        ctx.fillRect(x + 3, y + TILE - 8 - 6 * k, TILE - 6, 4);
        ctx.strokeStyle = '#c96a35';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 3, y + TILE - 8 - 6 * k, TILE - 6, 8 + 6 * k);
      }
    }

    drawPlatforms(ctx) {
      for (const p of this.L.plats) {
        const x = (p.dir === 'h' ? p.px : p.x) * TILE;
        const y = (p.dir === 'h' ? p.y : p.py) * TILE;
        ctx.fillStyle = '#c78b57';
        ctx.fillRect(x + 1, y + 6, TILE - 2, TILE - 12);
        ctx.fillStyle = '#8fd65f';
        ctx.fillRect(x + 1, y + 4, TILE - 2, 5);
        ctx.fillStyle = '#e8c193';
        ctx.fillRect(x + 4, y + 12, TILE - 8, 5);
        ctx.strokeStyle = '#8a5f38';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 4, TILE - 2, TILE - 10);
      }
    }

    drawExits(ctx) {
      const L = this.L;
      for (const role of ['fire', 'water']) {
        const ex = L.exits[role];
        if (!ex) continue;
        const x = ex.x * TILE, y = ex.y * TILE;
        const fire = role === 'fire';
        ctx.fillStyle = fire ? '#ff8a5c' : '#5fc0f5';
        ctx.beginPath();
        ctx.moveTo(x + 3, y + TILE);
        ctx.lineTo(x + 3, y + 10);
        ctx.quadraticCurveTo(x + 3, y - 8, x + 16, y - 8);
        ctx.quadraticCurveTo(x + 29, y - 8, x + 29, y + 10);
        ctx.lineTo(x + 29, y + TILE);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(x + 9, y + 8, TILE - 18, TILE - 8);
        // 图标
        if (fire) {
          ctx.fillStyle = '#ff6a3d';
          ctx.beginPath();
          ctx.moveTo(x + 16, y + 10);
          ctx.quadraticCurveTo(x + 8, y + 16, x + 11, y + 24);
          ctx.quadraticCurveTo(x + 11, y + 20, x + 16, y + 20);
          ctx.quadraticCurveTo(x + 15, y + 26, x + 19, y + 30);
          ctx.quadraticCurveTo(x + 22, y + 22, x + 16, y + 18);
          ctx.quadraticCurveTo(x + 23, y + 16, x + 16, y + 10);
          ctx.fill();
        } else {
          ctx.fillStyle = '#3aa8f0';
          ctx.beginPath();
          ctx.moveTo(x + 16, y + 9);
          ctx.quadraticCurveTo(x + 9, y + 16, x + 16, y + 27);
          ctx.quadraticCurveTo(x + 23, y + 16, x + 16, y + 9);
          ctx.fill();
        }
      }
    }

    drawChar(ctx, p, tag) {
      const isRemote = tag === 'remote';
      const x = isRemote ? p.x : p.x;
      const y = isRemote ? p.y : p.y;
      const cx = x + PW / 2;
      const feet = y + PH;
      const fire = isRemote ? false : p.role === 'fire';
      const role = isRemote ? (this.role === 'fire' ? 'water' : 'fire') : p.role;
      const isFire = role === 'fire';
      const bob = isRemote ? 0 : Math.sin(p.bob) * 1.5;
      const squash = isRemote ? 1 : p.squash;
      const stretch = isRemote ? 1 : p.stretch;
      const dir = isRemote ? p.dir : p.dir;

      ctx.save();
      ctx.translate(cx, feet + bob);
      ctx.scale(1 + (1 - squash) * 0.5, squash * (1 + (1 - stretch) * 0.5));
      ctx.scale(1, (1 + (stretch - 1) * 0.8));

      const R = 13;
      // 身体
      ctx.fillStyle = isFire ? '#ff8a5c' : '#5fc7ff';
      ctx.strokeStyle = isFire ? '#d95f35' : '#3898d8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, -R, R, R, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 肚皮
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(0, -R + 4, R * 0.55, R * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      // 眼睛
      const blink = isRemote ? 0 : p.blink;
      const ex = dir * 4;
      if (blink > 0) {
        ctx.strokeStyle = '#3a2a1a';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(ex - 4, -R - 3); ctx.lineTo(ex, -R - 1);
        ctx.moveTo(ex + 8, -R - 1); ctx.lineTo(ex + 12, -R - 3);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(ex - 3, -R - 2, 3.6, 4.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(ex + 9, -R - 2, 3.6, 4.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3a2a1a';
        ctx.beginPath(); ctx.arc(ex - 2 + dir, -R - 1, 1.9, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex + 10 + dir, -R - 1, 1.9, 0, Math.PI * 2); ctx.fill();
      }
      // 腮红
      ctx.fillStyle = 'rgba(255,120,120,0.5)';
      ctx.beginPath(); ctx.ellipse(ex - 8, -R + 5, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ex + 14, -R + 5, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
      // 头发
      if (isFire) {
        const fl = Math.sin(this.time * 9) * 2;
        ctx.fillStyle = '#ffb347';
        ctx.strokeStyle = '#d98a2b';
        ctx.lineWidth = 2;
        for (let i = -1; i <= 1; i++) {
          const fx = i * 7;
          const fh = 8 + (i === 0 ? 4 : 0) + fl * (i === 0 ? 1 : 0.6);
          ctx.beginPath();
          ctx.moveTo(fx - 4, -R * 2 + 2);
          ctx.quadraticCurveTo(fx, -R * 2 - fh, fx + 4, -R * 2 + 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = '#3aa8f0';
        ctx.strokeStyle = '#2577c0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -R * 2 - 2);
        ctx.quadraticCurveTo(-7, -R * 2 + 4, 0, -R * 2 + 8);
        ctx.quadraticCurveTo(7, -R * 2 + 4, 0, -R * 2 - 2);
        ctx.fill();
        ctx.stroke();
      }
      // 小脚
      ctx.fillStyle = isFire ? '#d95f35' : '#3898d8';
      ctx.beginPath();
      ctx.ellipse(-5, -2, 4, 2.6, 0, 0, Math.PI * 2);
      ctx.ellipse(5, -2, 4, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 远端角色头顶标签
      if (isRemote) {
        ctx.save();
        ctx.translate(cx, feet - R * 2 - 22);
        ctx.fillStyle = isFire ? 'rgba(255,138,92,0.9)' : 'rgba(95,199,255,0.9)';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(6, 3);
        ctx.lineTo(-6, 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    drawParticles(ctx) {
      for (const p of this.parts) {
        const a = clamp(p.life / p.maxLife, 0, 1);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(p.x, p.y);
        if (p.type === 'heart') {
          ctx.rotate(Math.sin(p.rot) * 0.4);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, p.size * 0.8);
          ctx.bezierCurveTo(-p.size, 0, -p.size * 0.5, -p.size, 0, -p.size * 0.3);
          ctx.bezierCurveTo(p.size * 0.5, -p.size, p.size, 0, 0, p.size * 0.8);
          ctx.fill();
        } else if (p.type === 'spark') {
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size * 0.35, 0);
          ctx.lineTo(0, p.size);
          ctx.lineTo(-p.size * 0.35, 0);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  FWF.Game = Game;
  FWF.parseLevel = parseLevel;
})(typeof window !== 'undefined' ? window : globalThis);
