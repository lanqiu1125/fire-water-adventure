/**
 * 冰火小冒险 —— 输入管理(键盘 + 触屏虚拟摇杆)
 *
 * 模式:
 *  - 'dual'   单机:键盘同时控制两人(WASD=小火, 方向键=小水);触屏用摇杆+换人
 *  - 'solo'   单机触屏/切换:摇杆只控制当前角色,可换人
 *  - 'fire' / 'water'  联机:所有输入控制自己这一侧角色
 */
(function (root) {
  const I = {
    mode: 'dual',           // dual | solo | fire | water
    active: 'fire',         // solo 模式下当前控制的角色
    fire: { left: false, right: false, jump: false, jumpBuf: 0 },
    water: { left: false, right: false, jump: false, jumpBuf: 0 },
    _joy: null,             // { id, ox, oy, x, y }
    _joyEl: null,
    _jumpTouch: null,
    _keys: {},
    _kbJumpPressed: { fire: false, water: false }
  };

  function charForTouch() {
    if (I.mode === 'fire') return 'fire';
    if (I.mode === 'water') return 'water';
    return I.active;
  }

  I.setMode = function (m) {
    I.mode = m;
    const touch = document.getElementById('touch-ui');
    if (touch) touch.style.display = (m === 'dual') ? 'none' : 'flex';
    const sw = document.getElementById('btn-switch');
    if (sw) sw.style.display = (m === 'solo') ? 'flex' : 'none';
  };

  I.switchActive = function () {
    I.active = I.active === 'fire' ? 'water' : 'fire';
    return I.active;
  };

  /* ---------- 键盘 ---------- */
  I.attachKeyboard = function () {
    const down = (e) => {
      const k = e.key;
      const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k);
      if (isArrow || k === 'Tab') e.preventDefault();
      I._keys[k] = true;
      if (I.mode === 'dual') {
        if (k === 'a' || k === 'A') I.fire.left = true;
        if (k === 'd' || k === 'D') I.fire.right = true;
        if (k === 'w' || k === 'W') { if (!I._kbJumpPressed.fire) { I.fire.jumpBuf = 0.12; I._kbJumpPressed.fire = true; } }
        if (k === 'ArrowLeft') I.water.left = true;
        if (k === 'ArrowRight') I.water.right = true;
        if (k === 'ArrowUp') { if (!I._kbJumpPressed.water) { I.water.jumpBuf = 0.12; I._kbJumpPressed.water = true; } }
      } else if (I.mode === 'solo') {
        const ch = I.active;
        if (k === 'a' || k === 'A' || k === 'ArrowLeft') I[ch].left = true;
        if (k === 'd' || k === 'D' || k === 'ArrowRight') I[ch].right = true;
        if ((k === 'w' || k === 'W' || k === 'ArrowUp' || k === ' ') && !I._kbJumpPressed.solo) {
          I[ch].jumpBuf = 0.12;
          I._kbJumpPressed.solo = true;
        }
        if (k === 'Tab') { I.switchActive(); }
      } else { // fire | water(联机:WASD 与方向键都可)
        const ch = I.mode;
        if (k === 'a' || k === 'A' || k === 'ArrowLeft') I[ch].left = true;
        if (k === 'd' || k === 'D' || k === 'ArrowRight') I[ch].right = true;
        if ((k === 'w' || k === 'W' || k === 'ArrowUp' || k === ' ') && !I._kbJumpPressed.online) {
          I[ch].jumpBuf = 0.12;
          I._kbJumpPressed.online = true;
        }
      }
    };
    const up = (e) => {
      const k = e.key;
      I._keys[k] = false;
      if (k === 'a' || k === 'A') I.fire.left = false;
      if (k === 'd' || k === 'D') I.fire.right = false;
      if (k === 'w' || k === 'W') I._kbJumpPressed.fire = false;
      if (k === 'ArrowLeft') I.water.left = false;
      if (k === 'ArrowRight') I.water.right = false;
      if (k === 'ArrowUp') I._kbJumpPressed.water = false;
      if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
        if (I.mode === 'solo') I._kbJumpPressed.solo = false;
        if (I.mode === 'fire' || I.mode === 'water') I._kbJumpPressed.online = false;
      }
    };
    const blur = () => {
      I.fire.left = I.fire.right = false;
      I.water.left = I.water.right = false;
      I._kbJumpPressed = { fire: false, water: false };
    };
    root.addEventListener('keydown', down);
    root.addEventListener('keyup', up);
    root.addEventListener('blur', blur);
  };

  /* ---------- 触屏虚拟摇杆 ---------- */
  I.attachTouch = function () {
    const joyEl = document.getElementById('joy-zone');
    const stickEl = document.getElementById('joy-stick');
    const jumpEl = document.getElementById('btn-jump');
    const switchEl = document.getElementById('btn-switch');
    if (!joyEl) return;
    I._joyEl = joyEl;

    joyEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      joyEl.setPointerCapture(e.pointerId);
      I._joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
    });
    joyEl.addEventListener('pointermove', (e) => {
      if (!I._joy || I._joy.id !== e.pointerId) return;
      const R = 52;
      let dx = e.clientX - I._joy.ox;
      let dy = e.clientY - I._joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      I._joy.x = dx;
      I._joy.y = dy;
      if (stickEl) stickEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    });
    const joyEnd = (e) => {
      if (I._joy && I._joy.id === e.pointerId) {
        I._joy = null;
        if (stickEl) stickEl.style.transform = 'translate(0,0)';
      }
    };
    joyEl.addEventListener('pointerup', joyEnd);
    joyEl.addEventListener('pointercancel', joyEnd);

    const jumpDown = (e) => {
      e.preventDefault();
      if (I._jumpTouch) return;
      I._jumpTouch = e.pointerId;
      jumpEl.setPointerCapture(e.pointerId);
      const ch = charForTouch();
      I[ch].jumpBuf = 0.12;
      I[ch].jumpHeld = true;
    };
    const jumpUp = (e) => {
      if (I._jumpTouch === e.pointerId) {
        I._jumpTouch = null;
        const ch = charForTouch();
        I[ch].jumpHeld = false;
      }
    };
    jumpEl.addEventListener('pointerdown', jumpDown);
    jumpEl.addEventListener('pointerup', jumpUp);
    jumpEl.addEventListener('pointercancel', jumpUp);

    if (switchEl) {
      switchEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        I.switchActive();
        root.FWF.audio && root.FWF.audio.sfx('select');
      });
    }
  };

  /** 每帧更新:把摇杆向量与跳跃缓冲写进对应角色 */
  I.update = function (dt) {
    for (const ch of ['fire', 'water']) {
      I[ch].jumpBuf = Math.max(0, (I[ch].jumpBuf || 0) - dt);
    }
    if (I._joy) {
      const ch = charForTouch();
      I[ch].left = I._joy.x < -16;
      I[ch].right = I._joy.x > 16;
    }
    if (I.mode === 'solo') {
      const other = I.active === 'fire' ? 'water' : 'fire';
      if (I._joy) { I[other].left = false; I[other].right = false; }
    }
  };

  /** 跳跃被消费(供 game.js 调用) */
  I.consumeJump = function (ch) {
    const had = I[ch].jumpBuf > 0 || I[ch].jumpHeld;
    if (!I[ch].jumpHeld) I[ch].jumpBuf = 0;
    return had;
  };

  root.FWF = root.FWF || {};
  root.FWF.input = I;
})(typeof window !== 'undefined' ? window : globalThis);
