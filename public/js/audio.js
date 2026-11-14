/**
 * 冰火小冒险 —— 音效引擎(WebAudio 合成,无需任何音频文件)
 */
(function (root) {
  const A = {
    ctx: null,
    master: null,
    sfxGain: null,
    musicGain: null,
    sfxOn: true,
    musicOn: true,
    _musicTimer: null,
    _step: 0,
    _nextNote: 0
  };

  A.unlock = function () {
    if (!A.ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      A.ctx = new AC();
      A.master = A.ctx.createGain();
      A.master.gain.value = 0.5;
      A.master.connect(A.ctx.destination);
      A.sfxGain = A.ctx.createGain();
      A.sfxGain.gain.value = 0.55;
      A.sfxGain.connect(A.master);
      A.musicGain = A.ctx.createGain();
      A.musicGain.gain.value = 0.16;
      A.musicGain.connect(A.master);
    }
    if (A.ctx.state === 'suspended') A.ctx.resume();
    if (A.musicOn && !A._musicTimer) A.startMusic();
  };

  A.tone = function (opts) {
    // {f0, f1, t, type, vol, delay, dest}
    if (!A.ctx || !A.sfxOn) return;
    const t0 = A.ctx.currentTime + (opts.delay || 0);
    const dur = opts.t || 0.15;
    const osc = A.ctx.createOscillator();
    const g = A.ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.f0, t0);
    if (opts.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.vol || 0.25, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(opts.dest || A.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  };

  A.noise = function (dur, vol) {
    if (!A.ctx || !A.sfxOn) return;
    const t0 = A.ctx.currentTime;
    const len = Math.floor(A.ctx.sampleRate * dur);
    const buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = A.ctx.createBufferSource();
    src.buffer = buf;
    const g = A.ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(A.sfxGain);
    src.start(t0);
  };

  A.sfx = function (name) {
    if (!A.ctx || !A.sfxOn) return;
    switch (name) {
      case 'jump':
        A.tone({ f0: 320, f1: 620, t: 0.12, type: 'square', vol: 0.12 });
        break;
      case 'bounce':
        A.tone({ f0: 260, f1: 900, t: 0.2, type: 'square', vol: 0.16 });
        break;
      case 'collect':
        A.tone({ f0: 880, t: 0.07, type: 'sine', vol: 0.2 });
        A.tone({ f0: 1318, t: 0.12, type: 'sine', vol: 0.2, delay: 0.06 });
        break;
      case 'death':
        A.tone({ f0: 420, f1: 90, t: 0.35, type: 'sawtooth', vol: 0.2 });
        A.noise(0.2, 0.1);
        break;
      case 'button':
        A.tone({ f0: 220, f1: 300, t: 0.08, type: 'square', vol: 0.14 });
        break;
      case 'door':
        A.tone({ f0: 300, f1: 520, t: 0.18, type: 'triangle', vol: 0.18 });
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) =>
          A.tone({ f0: f, t: 0.18, type: 'triangle', vol: 0.2, delay: i * 0.12 }));
        break;
      case 'select':
        A.tone({ f0: 600, f1: 700, t: 0.07, type: 'sine', vol: 0.15 });
        break;
      case 'error':
        A.tone({ f0: 200, f1: 140, t: 0.25, type: 'sawtooth', vol: 0.15 });
        break;
      case 'finish':
        A.tone({ f0: 700, f1: 1200, t: 0.25, type: 'sine', vol: 0.2 });
        break;
      case 'land':
        A.tone({ f0: 180, f1: 120, t: 0.06, type: 'sine', vol: 0.08 });
        break;
    }
  };

  // 轻快的 8 小节循环小曲(C 大调卡农走向: C-G-Am-Em-F-C-F-G)
  const NOTE = (n) => 440 * Math.pow(2, n / 12);
  const MELODY = [
    // 小节1 C
    [0, 1], [4, 1], [7, 1], [12, 1], [7, 0.5], [4, 0.5], [0, 1],
    // 小节2 G
    [7, 1], [11, 1], [14, 1], [11, 1], [7, 1], [4, 1],
    // 小节3 Am
    [9, 1], [12, 1], [16, 1], [12, 1], [9, 1], [5, 1],
    // 小节4 Em
    [4, 1], [7, 1], [11, 1], [7, 1], [4, 1], [2, 1],
    // 小节5 F
    [5, 1], [9, 1], [12, 1], [9, 1], [5, 1], [0, 1],
    // 小节6 C
    [0, 1], [4, 1], [7, 1], [12, 1], [7, 0.5], [4, 0.5],
    // 小节7 F
    [5, 1], [9, 1], [12, 1], [9, 1], [5, 1],
    // 小节8 G
    [2, 1], [7, 1], [11, 1], [14, 1], [11, 0.5], [7, 0.5]
  ];
  const BASS = [0, 7, -4, 2, -7, 0, -7, 7]; // 半音偏移(相对 A4)
  const SPB = 0.42; // 每拍秒数

  A.startMusic = function () {
    if (!A.ctx || A._musicTimer) return;
    A._step = 0;
    A._nextNote = A.ctx.currentTime + 0.1;
    A._musicTimer = setInterval(() => A._schedule(), 80);
  };
  A.stopMusic = function () {
    if (A._musicTimer) { clearInterval(A._musicTimer); A._musicTimer = null; }
  };
  A._schedule = function () {
    if (!A.ctx || !A.musicOn) return;
    while (A._nextNote < A.ctx.currentTime + 0.25) {
      const m = MELODY[A._step % MELODY.length];
      const bar = Math.floor(A._step / MELODY.length) % 8;
      const f = NOTE(m[0] + 12); // 高一个八度
      const dur = m[1] * SPB * 0.9;
      const osc = A.ctx.createOscillator();
      const g = A.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, A._nextNote);
      g.gain.exponentialRampToValueAtTime(0.5, A._nextNote + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, A._nextNote + dur);
      osc.connect(g);
      g.connect(A.musicGain);
      osc.start(A._nextNote);
      osc.stop(A._nextNote + dur + 0.05);
      // 低音(每小节第一拍)
      if (A._step % MELODY.length === 0) {
        const bf = NOTE(BASS[bar]);
        const bo = A.ctx.createOscillator();
        const bg = A.ctx.createGain();
        bo.type = 'sine';
        bo.frequency.value = bf;
        bg.gain.setValueAtTime(0.0001, A._nextNote);
        bg.gain.exponentialRampToValueAtTime(0.8, A._nextNote + 0.03);
        bg.gain.exponentialRampToValueAtTime(0.0001, A._nextNote + 1.6);
        bo.connect(bg);
        bg.connect(A.musicGain);
        bo.start(A._nextNote);
        bo.stop(A._nextNote + 1.7);
      }
      A._step++;
      A._nextNote += m[1] * SPB;
    }
  };

  A.toggleMusic = function () {
    A.musicOn = !A.musicOn;
    if (A.musicOn) {
      if (A.ctx && !A._musicTimer) A.startMusic();
    } else {
      A.stopMusic();
    }
    return A.musicOn;
  };
  A.toggleSfx = function () { A.sfxOn = !A.sfxOn; return A.sfxOn; };

  root.FWF = root.FWF || {};
  root.FWF.audio = A;
})(typeof window !== 'undefined' ? window : globalThis);
