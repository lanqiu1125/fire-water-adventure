/**
 * 冰火小冒险 —— 无尽关卡生成器(第 25 关起)
 * 每个关卡号 = 随机种子,同一关卡所有人看到的完全一样;
 * 生成时先铺一条可走的路,再往「路以外」的地方撒机关,并用 BFS 校验可通关。
 */
(function (root) {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function ri(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }

  function findCode(grid, code) {
    for (let y = 0; y < grid.length; y++) {
      const i = grid[y].indexOf(code);
      if (i >= 0) return { x: i, y: y };
    }
    return null;
  }

  const FLOOR = new Set(['#', '-', '|', '=', 'a', 'b', 'c', 'd', 'A', 'B', 'C', 'D']);
  function passableFor(char, c) {
    if (c === '#') return false;
    if (char === 'fire') return !('~P^'.includes(c));
    return !('LP^'.includes(c));
  }

  /** 宽松可达性检查:能走、能跳(跳高 3 格、跳远 4 格)、能乘移动平台,门按合作乐观处理 */
  function reachable(grid, char) {
    const from = findCode(grid, char === 'fire' ? 'F' : 'W');
    const to = findCode(grid, char === 'fire' ? 'X' : 'Y');
    if (!from || !to) return false;
    const H = grid.length, W = grid[0].length;
    const key = (x, y) => x + ',' + y;
    // 移动平台轨道上的“可乘骑节点”:平台中心在某行时,角色站在上一行
    const ride = new Set();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = grid[y][x];
        if (c === '-') {
          let l = x, r = x;
          while (l > 0 && !'#ABCD'.includes(grid[y][l - 1])) l--;
          while (r < W - 1 && !'#ABCD'.includes(grid[y][r + 1])) r++;
          if (y - 1 >= 0) for (let i = l; i <= r; i++) ride.add(key(i, y - 1));
        } else if (c === '|') {
          let u = y, d = y;
          while (u > 0 && !'#ABCD'.includes(grid[u - 1][x])) u--;
          while (d < H - 1 && !'#ABCD'.includes(grid[d + 1][x])) d++;
          for (let j = u; j <= d; j++) if (j - 1 >= 0) ride.add(key(x, j - 1));
        }
      }
    }
    const seen = new Set();
    const q = [[from.x, from.y]];
    seen.add(key(from.x, from.y));
    while (q.length) {
      const cur = q.shift();
      const x = cur[0], y = cur[1];
      if (x === to.x && y === to.y) return true;
      const tryCell = (nx, ny) => {
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) return;
        if (seen.has(key(nx, ny))) return;
        const c = grid[ny][nx];
        let standable;
        if (ride.has(key(nx, ny))) standable = c !== '#';
        else {
          const below = ny + 1 < H ? grid[ny + 1][nx] : '#';
          standable = passableFor(char, c) && FLOOR.has(below);
        }
        if (standable) {
          seen.add(key(nx, ny));
          q.push([nx, ny]);
        }
      };
      tryCell(x - 1, y);
      tryCell(x + 1, y);
      for (let dx = -4; dx <= 4; dx++) {
        for (let dy = -3; dy <= 5; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (Math.abs(dx) <= 1 && dy === 0) continue;
          tryCell(x + dx, y + dy);
        }
      }
      // 蹦床:向上弹 4~8 格,横向偏移 ±3
      const belowCur = y + 1 < H ? grid[y + 1][x] : '#';
      if (belowCur === '=' || grid[y][x] === '=') {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = -8; dy <= -4; dy++) tryCell(x + dx, y + dy);
        }
      }
    }
    return false;
  }

  function build(level) {
    const difficulty = Math.min(1, Math.max(0, (level - 24) / 16));
    const W = 24 + Math.min(6, Math.floor((level - 24) / 6));
    const H = 14 + (level >= 40 ? 2 : 0);

    for (let attempt = 0; attempt < 80; attempt++) {
      const rng = mulberry32(((level * 2654435761) >>> 0) + attempt * 40503);
      const grid = Array.from({ length: H }, () => Array(W).fill('.'));

      // 1) 地形随机游走(每步最多升降 2 格 → 一定跳得上去)
      const h = new Array(W);
      h[0] = H - 3;
      for (let x = 1; x < W; x++) {
        const nh = Math.max(5, Math.min(H - 2, h[x - 1] + ri(rng, -2, 2)));
        h[x] = nh;
      }
      for (let x = 0; x < 4; x++) h[x] = h[3];
      h[W - 1] = h[W - 2] = h[W - 3];
      for (let x = 0; x < W; x++) {
        for (let y = h[x]; y < H; y++) grid[y][x] = '#';
      }
      grid[h[1] - 1][1] = 'F';
      grid[h[3] - 1][3] = 'W';
      const ex1 = W - 3, ex2 = W - 2;
      grid[h[ex1] - 1][ex1] = 'X';
      grid[h[ex2] - 1][ex2] = 'Y';

      const used = new Array(W).fill(false);
      const markUsed = (from, to) => { for (let i = from; i <= to; i++) used[i] = true; };

      // 2) 危险池(只放在平地段落,太宽就配上方的平台)
      let x = 6;
      while (x < W - 6) {
        if (h[x] !== h[x - 1] || h[x] !== h[x + 1]) { x++; continue; }
        let end = x;
        while (end < W - 4 && h[end] === h[x]) end++;
        const segLen = end - x;
        if (segLen >= 3 && rng() < 0.3 + 0.42 * difficulty) {
          const maxLen = Math.min(segLen - 2, 3 + Math.round(2 * difficulty));
          const len = ri(rng, 2, Math.max(2, maxLen));
          const sx = x + ri(rng, 1, segLen - len - 1);
          let ok = sx > 6 && sx + len < W - 4;
          for (let i = sx; i < sx + len && ok; i++) {
            if (grid[h[i] - 1][i] !== '.' || used[i]) ok = false;
          }
          if (ok) {
            const roll = rng();
            let type;
            if (roll > 0.78) type = 'L';
            else if (roll > 0.55 && difficulty > 0.2) type = 'P';
            else if (roll > 0.34 && difficulty > 0.12) type = '^';
            else type = rng() < 0.5 ? '~' : 'L';
            for (let i = sx; i < sx + len; i++) { grid[h[i] - 1][i] = type; used[i] = true; }
            if (len >= 4) {
              const py = h[sx] - 2;
              for (let i = sx + 1; i < sx + len - 1; i++) {
                if (py >= 0 && grid[py][i] === '.') grid[py][i] = '#';
              }
              if (rng() < 0.75 && py - 1 >= 0 && grid[py - 1][sx + Math.floor(len / 2)] === '.') {
                grid[py - 1][sx + Math.floor(len / 2)] = '*';
              }
            }
            markUsed(sx, sx + len - 1);
            x = sx + len;
            continue;
          }
        }
        x++;
      }

      // 3) 移动平台(平地轨道,两端立柱子当轨道边界)
      const mpCount = difficulty > 0.6 ? 2 : (difficulty > 0.3 ? 1 : 0);
      for (let k = 0; k < mpCount; k++) {
        for (let tries = 0; tries < 25; tries++) {
          const mx = ri(rng, 8, W - 10);
          let flat = true;
          for (let i = mx; i <= mx + 3; i++) if (h[i] !== h[mx]) flat = false;
          if (!flat) continue;
          const row = h[mx] - 2;
          if (row < 2) continue;
          let ok = true;
          for (let i = mx - 1; i <= mx + 4; i++) {
            if (grid[row][i] !== '.' || grid[row - 1][i] !== '.') { ok = false; break; }
          }
          if (!ok) continue;
          grid[row][mx] = '-';
          grid[row][mx - 1] = '#';
          grid[row][mx + 4] = '#';
          if (rng() < 0.65 && grid[row - 1][mx + 1] === '.') grid[row - 1][mx + 1] = '*';
          break;
        }
      }

      // 4) 蹦床 + 高空宝石
      if (difficulty > 0.35 && rng() < 0.75) {
        for (let tries = 0; tries < 25; tries++) {
          const bx = ri(rng, 6, W - 8);
          if (used[bx] || h[bx] !== h[bx + 1]) continue;
          const row = h[bx] - 1;
          if (grid[row][bx] === '.' && row - 8 >= 0 && grid[row - 8][bx] === '.') {
            grid[row][bx] = '=';
            grid[row - 8][bx] = '*';
            used[bx] = true;
            break;
          }
        }
      }

      // 5) 空中浮岛(3 格高跳可达)与宝石
      const islands = ri(rng, 1, 2);
      for (let k = 0; k < islands; k++) {
        for (let tries = 0; tries < 20; tries++) {
          const ix = ri(rng, 5, W - 8);
          const row = h[ix] - 3;
          if (row < 3) continue;
          let ok = true;
          for (let i = ix; i < ix + 3; i++) {
            if (grid[row][i] !== '.' || grid[row - 1][i] !== '.') { ok = false; break; }
            if (Math.abs(h[i] - h[ix]) > 1) ok = false;
          }
          if (!ok) continue;
          for (let i = ix; i < ix + 3; i++) grid[row][i] = '#';
          if (grid[row - 1][ix + 1] === '.') grid[row - 1][ix + 1] = '*';
          break;
        }
      }

      // 6) 宝石
      const gemCount = 4 + Math.floor(3 * difficulty);
      let placed = 0;
      for (let tries = 0; tries < 250 && placed < gemCount; tries++) {
        const gx = ri(rng, 4, W - 5);
        const gy = h[gx] - 1;
        if (used[gx]) continue;
        if (gx === 1 || gx === 3 || gx === ex1 || gx === ex2) continue;
        if (grid[gy][gx] === '.') {
          grid[gy][gx] = '*';
          used[gx] = true;
          placed++;
        }
      }

      if (reachable(grid, 'fire') && reachable(grid, 'water')) {
        const hints = [
          '随机生成的关卡,每关都不一样,放心冲!',
          '注意脚下的移动平台,时机很重要~',
          '池子太宽就走上面的平台,别硬跳!',
          '蹦床可以送你到很高的宝石那里!',
          '路是通的,别怕,慢慢来~'
        ];
        return {
          name: '无尽关卡 ' + level,
          hint: hints[level % hints.length],
          opts: { plats: 1 + Math.min(0.6, difficulty * 0.6) },
          map: grid.map(r => r.join(''))
        };
      }
    }
    // 兜底:极其简单的地图(理论上不会走到这里)
    const g = Array.from({ length: 14 }, () => Array(26).fill('.'));
    for (let x = 0; x < 26; x++) g[13][x] = '#';
    g[12][1] = 'F'; g[12][3] = 'W'; g[12][23] = 'X'; g[12][24] = 'Y'; g[12][10] = '*'; g[12][15] = '*';
    return { name: '无尽关卡 ' + level, hint: '平坦的兜底关卡', map: g.map(r => r.join('')) };
  }

  function generate(level) { return build(level); }

  const api = { generate: generate, reachable: reachable, _build: build };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.FWF = root.FWF || {};
    root.FWF.gen = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
