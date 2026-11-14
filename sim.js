/**
 * 无头引擎模拟测试: node tools/sim.js
 * 在 Node 中给 game.js 挂上最小 DOM 桩,验证物理与机关行为:
 * 跳跃高度/距离、贴墙不穿透、站立不陷地、水火免疫、按钮开门与宽限、
 * 蹦床、宝石/出口/过关、移动平台携带。
 */
'use strict';

// ---------- 最小浏览器环境桩 ----------
const noop = () => {};
function makeCtx() {
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'createLinearGradient') return () => ({ addColorStop: noop });
      if (prop in t) return t[prop];
      return noop;
    },
    set(t, prop, v) { t[prop] = v; return true; }
  });
}
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.requestAnimationFrame = noop;
globalThis.cancelAnimationFrame = noop;

const canvas = {
  clientWidth: 1280, clientHeight: 720,
  width: 0, height: 0,
  getContext: () => makeCtx()
};

const FWF = globalThis.FWF = globalThis.FWF || {};
FWF.audio = { sfx: noop, unlock: noop };
FWF.input = {
  mode: 'dual',
  active: 'fire',
  fire: { left: false, right: false, jumpBuf: 0, jumpHeld: false },
  water: { left: false, right: false, jumpBuf: 0, jumpHeld: false },
  setMode: noop, switchActive: noop
};

require('../public/js/levels.js');
require('../public/js/game.js');
const { LEVELS } = FWF.LEVELS ? { LEVELS: FWF.LEVELS } : require('../public/js/levels.js');

let passed = 0, failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};

const DT = 1 / 60;
function makeGame(def, opts) {
  return new FWF.Game(canvas, Object.assign({ level: 1, mode: 'solo', t0: 0, levelDef: def }, opts || {}));
}
function run(game, frames, fn) {
  for (let i = 0; i < frames; i++) {
    fn && fn(i);
    game.step(DT);
  }
}
const resetInput = () => {
  FWF.input.fire = { left: false, right: false, jumpBuf: 0, jumpHeld: false };
  FWF.input.water = { left: false, right: false, jumpBuf: 0, jumpHeld: false };
};

(async () => {
  console.log('== 引擎无头模拟测试 ==');

  // ---- A. 跳跃高度(必须 ≥3 格=96px) ----
  {
    const g = makeGame(LEVELS[0]);
    resetInput();
    FWF.input.fire.jumpBuf = 0.12;
    let minY = Infinity, grounded = 0;
    run(g, 90, (i) => { minY = Math.min(minY, g.fire.y); if (g.fire.onGround) grounded++; });
    const h = g.fire.spawnY - minY;
    check('跳跃高度 ≈3 格(实测 ' + Math.round(h) + 'px)', h >= 96 && h <= 115);
    check('跳后回到地面', g.fire.onGround === true);
  }

  // ---- B. 平地起跳距离 ----
  {
    const g = makeGame(LEVELS[0]);
    resetInput();
    run(g, 10); // 先站稳
    FWF.input.fire.jumpBuf = 0.12;
    FWF.input.fire.right = true;
    const startX = g.fire.x;
    let air = false, landX = null;
    run(g, 90, () => {
      if (!g.fire.onGround) air = true;
      else if (air && landX === null) landX = g.fire.x;
    });
    const d = landX === null ? 9999 : landX - startX;
    check('平地跳跃距离 ≥4 格(实测 ' + Math.round(d) + 'px)', d >= 128 && d <= 210);
  }

  // ---- C. 静立不陷地 ----
  {
    const g = makeGame(LEVELS[0]);
    resetInput();
    run(g, 120);
    check('静立时稳稳站在地面', Math.abs(g.fire.y - g.fire.spawnY) < 0.01 && g.fire.onGround);
  }

  // ---- D. 顶墙不穿透 ----
  {
    const g = makeGame(LEVELS[0]);
    resetInput();
    FWF.input.fire.left = true;
    run(g, 150);
    check('撞左墙不穿透', g.fire.x >= 0 && g.fire.vx === 0);
  }

  // ---- E. 水火免疫与致死 ----
  {
    const g = makeGame({
      name: 't', map: [
        '...........',
        'FW~L.....XY',
        '###########'
      ]
    });
    resetInput();
    FWF.input.fire.right = true;
    FWF.input.water.right = true;
    let fireDiedInWater = false, waterDiedInLava = false;
    run(g, 300, () => {
      if (g.fire.dead && g.fire.x < 4 * 32) fireDiedInWater = true;   // 在水池列死
      if (g.water.dead && g.water.x < 5 * 32) waterDiedInLava = true;
    });
    check('小火碰到水池会阵亡', fireDiedInWater);
    check('小水碰到岩浆会阵亡', waterDiedInLava);
    // 免疫:小火跨过水池列落在岩浆列不死
    const g2 = makeGame({
      name: 't2', map: [
        '...........',
        'F.WL.....XY',
        '###########'
      ]
    });
    resetInput();
    FWF.input.fire.right = true;
    let fireAliveInLava = false;
    run(g2, 300, () => { if (g2.fire.x > 3 * 32 && g2.fire.x < 5 * 32 && !g2.fire.dead) fireAliveInLava = true; });
    check('小火对岩浆免疫', fireAliveInLava);
  }

  // ---- F. 按钮开门 + 松手宽限 ----
  {
    const g = makeGame({
      name: 't3', map: [
        '..............',
        'F..A...a.W..XY',
        '##############'
      ]
    });
    resetInput();
    // 门关着时小火会被挡住
    run(g, 20, () => { FWF.input.fire.right = true; });
    check('门关着时小火过不去', g.fire.x < 3 * 32 + 20 && !g.fire.finished, 'x=' + Math.round(g.fire.x));
    // 小水走去按钮踩住
    let doorOpenSeen = false;
    run(g, 90, () => {
      FWF.input.fire.right = false;
      FWF.input.water.left = true;
      if (g.L.buttons.a.on) doorOpenSeen = true;
    });
    check('小水踩住按钮 → 门开', doorOpenSeen);
    // 小火趁机过门
    let firePassed = false;
    run(g, 60, () => { FWF.input.water.left = false; FWF.input.fire.right = true; if (g.fire.x > 4 * 32) firePassed = true; });
    check('小火趁着门开通过', firePassed);
    // 小水松手,门有宽限
    run(g, 3, () => { FWF.input.water.right = true; });
    check('松手后门有宽限时间', g.L.doors.A.grace > 0);
    // 两人都到出口
    run(g, 600, () => { FWF.input.water.right = true; FWF.input.fire.right = true; });
    check('小水到达出口', g.water.finished === true);
    check('小火到达出口', g.fire.finished === true);
  }

  // ---- G. 蹦床 ----
  {
    const g = makeGame({
      name: 't4', map: [
        '...........',
        'F..=..W..XY',
        '###########'
      ]
    });
    resetInput();
    FWF.input.fire.right = true;
    let minY = Infinity;
    run(g, 120, () => { minY = Math.min(minY, g.fire.y); });
    const rise = g.fire.spawnY - minY;
    check('蹦床能弹起 ≥6 格(实测 ' + Math.round(rise) + 'px)', rise >= 190);
  }

  // ---- H. 宝石 / 出口 / 过关回调(L1) ----
  {
    let done = null;
    const g = makeGame(LEVELS[0], { onComplete: (s) => { done = s; } });
    resetInput();
    run(g, 700, () => { FWF.input.fire.right = true; FWF.input.water.right = true; });
    check('两人到达出口触发过关', !!done);
    check('路上收集了地面宝石', done && done.gems >= 2, done && JSON.stringify(done));
  }

  // ---- I. 移动平台携带 ----
  {
    const g = makeGame({
      name: 't5', map: [
        '..........',
        '....F.....',
        '..#..-.#.W',
        '##########'
      ]
    });
    resetInput();
    run(g, 400);
    const before = g.fire.x;
    const plat = g.L.plats[0];
    const pBefore = plat.px;
    run(g, 40);
    const carried = (g.fire.x - before) !== 0 && Math.abs((g.fire.x - before) - (plat.px - pBefore) * 32) < 1;
    check('角色站在移动平台上会被携带', carried,
      '角色Δ=' + Math.round(g.fire.x - before) + ' 平台Δ=' + Math.round((plat.px - pBefore) * 32));
  }

  // ---- J. 移动平台物理一致性:同相位(双客户端确定性) ----
  {
    const def = LEVELS[5]; // 会动的桥
    const g1 = makeGame(def), g2 = makeGame(def);
    resetInput();
    run(g1, 500); run(g2, 500);
    let same = true;
    for (let i = 0; i < g1.L.plats.length; i++) {
      if (Math.abs(g1.L.plats[i].px - g2.L.plats[i].px) > 0.001) same = false;
    }
    check('平台运动只由关卡时钟决定(联机两端一致)', same);
  }

  // ---- K. 渲染冒烟:所有关卡(手工+生成)与联机远端渲染路径 ----
  {
    let ok = true, bad = '';
    try {
      for (let i = 0; i < LEVELS.length; i++) {
        const g = makeGame(LEVELS[i]);
        resetInput();
        run(g, 20, () => { FWF.input.fire.right = true; FWF.input.water.left = true; });
        g.render();
        g.destroy();
      }
      const gen = require('../public/js/gen.js');
      for (let lv = 25; lv <= 30; lv++) {
        const g = makeGame(gen.generate(lv));
        resetInput();
        run(g, 20);
        g.render();
        g.destroy();
      }
      // 联机远端渲染
      const g = makeGame(LEVELS[5], { mode: 'online', role: 'fire' });
      resetInput();
      run(g, 10);
      g.pushPeerState({ x: 100, y: 200, dir: 1, dead: false, finished: false });
      g.pushPeerState({ x: 110, y: 200, dir: 1, dead: false, finished: false });
      run(g, 10, () => { FWF.input.fire.right = true; });
      g.render();
      g.destroy();
    } catch (e) {
      ok = false;
      bad = e.message;
    }
    check('全部关卡与联机路径渲染无异常', ok, bad);
  }

  console.log('----------------------------------------');
  console.log(failed === 0 ? '结果: 全部通过 (' + passed + ' 项)' : '结果: ' + failed + ' 项失败 / ' + passed + ' 项通过');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
