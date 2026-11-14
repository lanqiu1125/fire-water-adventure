/**
 * 冰火小冒险 —— 主流程:界面、选关、联机房间、结算、进度保存
 */
(function () {
  const FWF = window.FWF;
  const A = FWF.audio;
  const IS_TOUCH = 'ontouchstart' in window;

  const $ = (id) => document.getElementById(id);
  const S = {
    screen: 'title',
    mode: null,          // solo | online
    role: 'fire',
    roomCode: '',
    level: 1,
    game: null,
    net: null,
    serverUrl: localStorage.getItem('fwf_server') || '',
    connecting: false,
    completed: false
  };

  const P = {
    unlocked: 1,
    stars: {}
  };
  try {
    const saved = JSON.parse(localStorage.getItem('fwf_progress') || '{}');
    if (saved.unlocked) P.unlocked = saved.unlocked;
    if (saved.stars) P.stars = saved.stars;
  } catch (e) {}

  function saveProgress() {
    localStorage.setItem('fwf_progress', JSON.stringify({ unlocked: P.unlocked, stars: P.stars }));
  }

  function getLevelDef(level) {
    if (level <= FWF.LEVELS.length) return FWF.LEVELS[level - 1];
    return FWF.gen.generate(level);
  }

  /* ---------------- 界面切换 ---------------- */
  function showScreen(name) {
    S.screen = name;
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    const el = $('screen-' + name);
    if (el) el.classList.add('active');
    $('hud').style.display = (name === 'game') ? 'flex' : 'none';
    $('btn-pause-top').style.display = (name === 'game') ? 'flex' : 'none';
  }

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  /* ---------------- 音频 ---------------- */
  function unlockAudio() {
    A.unlock();
  }
  window.addEventListener('pointerdown', unlockAudio, { once: false });
  window.addEventListener('keydown', unlockAudio);

  function refreshSoundBtn() {
    const b = $('btn-music');
    if (b) b.innerHTML = A.musicOn ? '🎵 音乐:开' : '🎵 音乐:关';
  }
  $('btn-music').addEventListener('click', () => {
    unlockAudio();
    A.toggleMusic();
    refreshSoundBtn();
  });

  /* ---------------- 标题页 ---------------- */
  $('btn-solo').addEventListener('click', () => {
    A.sfx('select');
    S.mode = 'solo';
    S.pending = null;
    buildLevelGrid('单人闯关,选一关开始!');
    showScreen('select');
  });
  $('btn-online').addEventListener('click', () => {
    A.sfx('select');
    S.mode = 'online';
    $('join-code').value = $('server-url').value = '';
    $('server-url').value = S.serverUrl;
    showScreen('online');
  });
  $('btn-select').addEventListener('click', () => {
    A.sfx('select');
    S.mode = 'solo';
    S.pending = null;
    buildLevelGrid('选择关卡');
    showScreen('select');
  });
  $('btn-help').addEventListener('click', () => {
    A.sfx('select');
    showScreen('help');
  });
  document.querySelectorAll('[data-back]').forEach((el) => {
    el.addEventListener('click', () => {
      A.sfx('select');
      showScreen(el.getAttribute('data-back'));
    });
  });

  /* ---------------- 选关 ---------------- */
  function buildLevelGrid(title) {
    $('select-title').textContent = title;
    const grid = $('level-grid');
    grid.innerHTML = '';
    const addBtn = (label, sub, level, enabled, star) => {
      const b = document.createElement('button');
      b.className = 'level-btn' + (enabled ? '' : ' locked');
      b.innerHTML = '<span class="lv-num">' + label + '</span>' +
        '<span class="lv-sub">' + sub + '</span>' +
        '<span class="lv-star">' + (star === 3 ? '⭐⭐⭐' : star === 2 ? '⭐⭐' : star === 1 ? '⭐' : '') + '</span>';
      if (enabled) {
        b.addEventListener('click', () => {
          A.sfx('select');
          chooseLevel(level);
        });
      } else {
        b.innerHTML = '<span class="lv-num">🔒</span><span class="lv-sub">' + sub + '</span><span class="lv-star"></span>';
      }
      grid.appendChild(b);
    };
    for (let i = 0; i < 24; i++) {
      const lv = i + 1;
      addBtn(lv, FWF.LEVELS[i].name, lv, lv <= P.unlocked, P.stars[lv] || 0);
    }
    // 无尽模式入口
    const infLevel = Math.max(25, P.unlocked);
    addBtn('∞', '无尽挑战', infLevel, P.unlocked >= 25, P.stars[infLevel] || 0);
  }

  function chooseLevel(level) {
    S.level = level;
    if (S.mode === 'online') {
      createRoom(level);
    } else {
      startSoloGame(level);
    }
  }

  /* ---------------- 单机 ---------------- */
  function startSoloGame(level) {
    if (S.game) { S.game.destroy(); S.game = null; }
    S.completed = false;
    showScreen('game');
    const def = getLevelDef(level);
    const t0 = Date.now() + 2600;
    S.game = new FWF.Game($('game-canvas'), {
      level, mode: 'solo', t0, levelDef: def,
      onComplete: (stats) => onComplete(level, stats),
      onHud: (h) => updateHud(h),
      onToast: toast,
      onFrame: (clock) => updateCountdown(clock, level, def)
    });
    FWF.input.setMode(S.game.controlMode);
    FWF.input.active = 'fire';
    $('hud-level').textContent = '第 ' + level + ' 关 · ' + def.name;
    $('hud-role').innerHTML = '';
    S.game.start();
  }

  /* ---------------- 联机 ---------------- */
  function wsUrl() {
    if (S.serverUrl && S.serverUrl.trim()) return S.serverUrl.trim();
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return proto + location.host;
  }

  function ensureNet(cb) {
    if (S.net && S.net.connected) { cb(); return; }
    if (S.connecting) return;
    S.connecting = true;
    if (!S.net) {
      S.net = new FWF.Net();
      S.net.on('room', (d) => {
        S.role = d.role;
        S.roomCode = d.code;
        $('wait-code').textContent = d.code;
        $('wait-role').innerHTML = d.role === 'fire'
          ? '<span class="fire-chip">🔥 你是小火</span>'
          : '<span class="water-chip">💧 你是小水</span>';
        showScreen('wait');
        if (d.peer) toast('小伙伴已经在了,马上开始!');
      });
      S.net.on('load', (d) => startOnlineGame(d.level, d.t0));
      S.net.on('state', (d) => { if (S.game) S.game.pushPeerState(d.s); });
      S.net.on('event', (d) => { if (S.game) S.game.applyPeerEvent(d.e); });
      S.net.on('peer_left', () => {
        if (S.screen === 'wait') toast('房主离开了房间…');
        if (S.game) S.game.setPeerGone();
      });
      S.net.on('error', (d) => {
        S.connecting = false;
        toast(d.msg || '出错了');
        showScreen('online');
      });
      S.net.on('close', () => {
        S.connecting = false;
        if (S.screen === 'game') {
          $('dc-code').textContent = S.roomCode;
          showScreen('disconnect');
        } else if (S.screen === 'wait') {
          toast('与服务器断开连接了');
          showScreen('online');
        }
      });
    }
    toast('正在连接服务器…', 1500);
    S.net.connect(wsUrl(), (err) => {
      S.connecting = false;
      if (err) {
        toast('无法连接服务器:' + (err.message || '') + '(检查地址或稍后重试)');
        showScreen('online');
        return;
      }
      cb && cb();
    });
  }

  $('btn-create').addEventListener('click', () => {
    A.sfx('select');
    S.serverUrl = $('server-url').value.trim();
    localStorage.setItem('fwf_server', S.serverUrl);
    S.mode = 'online';
    S.pending = 'create';
    buildLevelGrid('创建房间:选一个关卡等小伙伴加入');
    showScreen('select');
  });

  $('btn-join').addEventListener('click', () => {
    A.sfx('select');
    const code = $('join-code').value.trim().toUpperCase();
    S.serverUrl = $('server-url').value.trim();
    localStorage.setItem('fwf_server', S.serverUrl);
    if (!code) { toast('先输入 4 位房间号哦~'); return; }
    ensureNet(() => S.net.joinRoom(code));
  });

  function createRoom(level) {
    ensureNet(() => S.net.createRoom(level));
  }

  function startOnlineGame(level, t0) {
    if (S.game) { S.game.destroy(); S.game = null; }
    S.completed = false;
    S.level = level;
    const def = getLevelDef(level);
    $('countdown').classList.add('active');
    showScreen('game');
    S.game = new FWF.Game($('game-canvas'), {
      level, mode: 'online', role: S.role, t0, net: S.net, levelDef: def,
      onComplete: (stats) => onComplete(level, stats),
      onHud: (h) => updateHud(h),
      onToast: toast,
      onFrame: (clock) => updateCountdown(clock, level, def)
    });
    FWF.input.setMode(S.role);
    $('hud-level').textContent = '第 ' + level + ' 关 · ' + def.name;
    $('hud-role').innerHTML = S.role === 'fire'
      ? '<span class="fire-chip">🔥 你控制小火</span>'
      : '<span class="water-chip">💧 你控制小水</span>';
    $('hud-code').innerHTML = '🏠 ' + S.roomCode;
    S.game.start();
  }

  $('btn-cancel-wait').addEventListener('click', () => {
    A.sfx('select');
    if (S.net) S.net.close();
    showScreen('online');
  });
  $('wait-code').addEventListener('click', () => {
    const code = $('wait-code').textContent;
    if (code && navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => toast('房间号已复制,发给小伙伴吧!'));
    }
  });

  /* ---------------- 倒计时 ---------------- */
  function updateCountdown(clock, level, def) {
    const remain = (S.game ? S.game.t0 : 0) - clock;
    const el = $('countdown');
    if (remain > 0) {
      el.classList.add('active');
      const n = Math.ceil(remain / 1000);
      $('cd-num').textContent = n;
      $('cd-info').textContent = '第 ' + level + ' 关 · ' + def.name;
      $('cd-hint').textContent = '💡 ' + (def.hint || '');
    } else {
      if (el.classList.contains('active')) {
        el.classList.remove('active');
        A.sfx('button');
      }
    }
  }

  /* ---------------- HUD ---------------- */
  function updateHud(h) {
    $('hud-gems').textContent = '💎 ' + h.gems + '/' + h.gemTotal;
    $('hud-deaths').textContent = '💫 ' + h.deaths;
    if (S.net && S.net.connected) {
      $('hud-ping').textContent = '📶 ' + Math.round(S.net.rtt) + 'ms';
    } else {
      $('hud-ping').textContent = '';
    }
  }

  /* ---------------- 暂停 ---------------- */
  function togglePause() {
    if (!S.game || S.screen !== 'game') return;
    if ($('screen-pause').classList.contains('active')) {
      resumeGame();
    } else {
      S.game.pause();
      $('screen-pause').classList.add('active');
    }
  }
  function resumeGame() {
    $('screen-pause').classList.remove('active');
    if (S.game) S.game.resume();
  }
  $('btn-pause-top').addEventListener('click', () => { A.sfx('select'); togglePause(); });
  $('btn-resume').addEventListener('click', () => { A.sfx('select'); resumeGame(); });
  $('btn-retry').addEventListener('click', () => {
    A.sfx('select');
    resumeGame();
    if (S.mode === 'online') S.net.restart();
    else startSoloGame(S.level);
  });
  $('btn-quit').addEventListener('click', () => {
    A.sfx('select');
    resumeGame();
    leaveGame();
    showScreen(S.mode === 'online' ? 'online' : 'select');
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (S.screen === 'game') togglePause();
    }
  });

  function leaveGame() {
    if (S.game) { S.game.destroy(); S.game = null; }
    if (S.mode === 'online' && S.net) S.net.close();
    $('screen-pause').classList.remove('active');
    $('countdown').classList.remove('active');
    $('screen-complete').classList.remove('active');
  }

  /* ---------------- 结算 ---------------- */
  function onComplete(level, stats) {
    const stars = (stats.gems === stats.gemTotal && stats.deaths === 0) ? 3
      : (stats.gems === stats.gemTotal ? 2 : 1);
    P.unlocked = Math.min(999, Math.max(P.unlocked, level + 1));
    P.stars[level] = Math.max(P.stars[level] || 0, stars);
    saveProgress();
    A.sfx('win');
    $('cp-stars').innerHTML = '⭐'.repeat(stars) + '<span class="dim-star">' + '☆'.repeat(3 - stars) + '</span>';
    $('cp-stats').textContent = '宝石 ' + stats.gems + '/' + stats.gemTotal + ' · 阵亡 ' + stats.deaths + ' 次';
    $('cp-level').textContent = '第 ' + level + ' 关 完成!';
    $('btn-next').style.display = (P.unlocked >= 25 || level < 24) ? 'inline-block' : 'none';
    $('screen-complete').classList.add('active');
    S.completed = true;
  }
  $('btn-next').addEventListener('click', () => {
    A.sfx('select');
    $('screen-complete').classList.remove('active');
    if (S.mode === 'online') S.net.done(S.level);
    else startSoloGame(S.level + 1);
  });
  $('btn-replay').addEventListener('click', () => {
    A.sfx('select');
    $('screen-complete').classList.remove('active');
    if (S.mode === 'online') S.net.restart();
    else startSoloGame(S.level);
  });
  $('btn-back').addEventListener('click', () => {
    A.sfx('select');
    $('screen-complete').classList.remove('active');
    leaveGame();
    showScreen('select');
  });

  /* ---------------- 断线重连 ---------------- */
  $('btn-dc-retry').addEventListener('click', () => {
    A.sfx('select');
    const code = S.roomCode;
    ensureNet(() => S.net.joinRoom(code));
    showScreen('wait');
  });
  $('btn-dc-back').addEventListener('click', () => {
    A.sfx('select');
    if (S.game) { S.game.destroy(); S.game = null; }
    showScreen('online');
  });

  /* ---------------- 切后台自动暂停 ---------------- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && S.game && S.screen === 'game' && !S.completed) {
      S.game.pause();
      $('screen-pause').classList.add('active');
    }
  });

  /* ---------------- 初始化 ---------------- */
  FWF.input.attachKeyboard();
  FWF.input.attachTouch();
  window.addEventListener('resize', () => { if (S.game) S.game._resize(); });

  refreshSoundBtn();
  showScreen('title');
})();
