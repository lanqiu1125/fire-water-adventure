/**
 * 关卡校验工具: node tools/validate.js
 * 检查 24 个手工关卡 + 无尽关卡生成器:
 *  - 每行长度一致、出生点/出口齐全
 *  - 按钮/门配对
 *  - 移动平台轨道两端有边界
 *  - 小火/小水分别能从出生点到达出口(BFS 可达性)
 */
'use strict';
const path = require('path');
const { LEVELS } = require(path.join(__dirname, '..', 'public', 'js', 'levels.js'));
const gen = require(path.join(__dirname, '..', 'public', 'js', 'gen.js'));

let errors = 0;
let warnings = 0;
const err = (s) => { errors++; console.log('  [错误] ' + s); };
const warn = (s) => { warnings++; console.log('  [警告] ' + s); };

function checkLevel(def, label) {
  const map = def.map;
  console.log('\n== 关卡: ' + label + (def.name ? ' (' + def.name + ')' : '') + ' ==');
  const H = map.length;
  const W = map[0].length;
  if (W < 10 || H < 6) err('尺寸异常 ' + W + 'x' + H);
  for (let y = 0; y < H; y++) {
    if (map[y].length !== W) {
      err(`第 ${y} 行长度 ${map[y].length} ≠ ${W}`);
      return;
    }
    for (let x = 0; x < W; x++) {
      const c = map[y][x];
      if (!'#.FWXYL~P^*=abcdABCD-|'.includes(c)) err(`第 ${y} 行第 ${x} 列出现未知符号 "${c}"`);
    }
  }
  const count = (ch) => map.join('').split(ch).length - 1;
  if (count('F') !== 1) err('小火出生点 F 必须恰好 1 个(现有 ' + count('F') + ')');
  if (count('W') !== 1) err('小水出生点 W 必须恰好 1 个(现有 ' + count('W') + ')');
  if (count('X') < 1) err('缺少小火出口 X');
  if (count('Y') < 1) err('缺少小水出口 Y');

  // 按钮 / 门配对
  for (const door of ['A', 'B', 'C', 'D']) {
    const dc = count(door);
    const bc = count(door.toLowerCase());
    if (dc && !bc) err(`有门 ${door} 但没有按钮 ${door.toLowerCase()}`);
    if (bc && !dc) warn(`有按钮 ${door.toLowerCase()} 但没有门 ${door}`);
  }
  // 移动平台轨道边界
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = map[y][x];
      if (c === '-') {
        let l = x, r = x;
        while (l > 0 && !'#ABCD'.includes(map[y][l - 1])) l--;
        while (r < W - 1 && !'#ABCD'.includes(map[y][r + 1])) r++;
        if (l <= 0 && r >= W - 1) err(`横移平台 (${x},${y}) 两端都没有边界墙,会飞出地图`);
      }
      if (c === '|') {
        let u = y, d = y;
        while (u > 0 && !'#ABCD'.includes(map[u - 1][x])) u--;
        while (d < H - 1 && !'#ABCD'.includes(map[d + 1][x])) d++;
        if (u <= 0 && d >= H - 1) warn(`电梯 (${x},${y}) 上下都没有边界`);
      }
    }
  }
  // 可达性
  const fireOk = gen.reachable(map, 'fire');
  const waterOk = gen.reachable(map, 'water');
  if (!fireOk) err('小火无法到达出口!(可跳 3 格高/4 格远,门按合作乐观处理)');
  if (!waterOk) err('小水无法到达出口!');
  if (fireOk && waterOk) console.log('  ✓ 小火/小水路线均可达');
}

for (let i = 0; i < LEVELS.length; i++) {
  checkLevel(LEVELS[i], (i + 1) + '/手工');
}

console.log('\n== 无尽关卡生成器抽查(25~34 各生成一次) ==');
for (let lv = 25; lv <= 34; lv++) {
  const g = gen.generate(lv);
  checkLevel(g, lv + '/生成');
}

console.log('\n----------------------------------------');
if (errors) {
  console.log(`结果: ${errors} 个错误, ${warnings} 个警告 —— 需要修复!`);
  process.exit(1);
} else {
  console.log(`结果: 全部通过!(${warnings} 个警告)`);
  process.exit(0);
}
