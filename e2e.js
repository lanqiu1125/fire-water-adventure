/**
 * 端到端联机测试: node tools/e2e.js [端口]
 * 依赖 Node 22+ 内置 WebSocket 客户端与 fetch。
 * 覆盖:静态页、创建房间、加入、load 广播、状态/事件中继、过关推进、重启、断线通知。
 */
'use strict';
const PORT = process.argv[2] || 3000;
const BASE = 'http://127.0.0.1:' + PORT;
const WS = 'ws://127.0.0.1:' + PORT;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

function wsClient() {
  const ws = new WebSocket(WS);
  const queue = [];
  const waiters = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    const w = waiters.find((x) => x.t === m.t);
    if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    else queue.push(m);
  };
  const waitFor = (t, ms) => new Promise((resolve, reject) => {
    const i = queue.findIndex((x) => x.t === t);
    if (i >= 0) { resolve(queue.splice(i, 1)[0]); return; }
    waiters.push({ t, resolve });
    setTimeout(() => { const j = waiters.findIndex((x) => x.t === t && x.resolve === resolve); if (j >= 0) { waiters.splice(j, 1); reject(new Error('等待超时: ' + t)); } }, ms || 4000);
  });
  return { ws, send: (o) => ws.send(JSON.stringify(o)), waitFor };
}

(async () => {
  console.log('== 端到端联机测试 ==');
  // 静态页
  try {
    const res = await fetch(BASE + '/');
    check('首页可访问', res.status === 200 && (await res.text()).includes('冰火小冒险'));
  } catch (e) { check('首页可访问', false, e.message); }
  try {
    const res = await fetch(BASE + '/js/game.js');
    check('静态资源可访问', res.status === 200);
  } catch (e) { check('静态资源可访问', false, e.message); }

  const A = wsClient();
  await new Promise((r) => { A.ws.onopen = r; });
  A.send({ t: 'create', level: 3 });
  const created = await A.waitFor('created');
  check('创建房间返回角色 fire', created.role === 'fire' && created.code.length === 4, JSON.stringify(created));
  const code = created.code;

  const B = wsClient();
  await new Promise((r) => { B.ws.onopen = r; });
  B.send({ t: 'join', code });
  const joined = await B.waitFor('joined');
  check('加入房间返回角色 water', joined.role === 'water' && joined.peer === true, JSON.stringify(joined));

  const loadA = await A.waitFor('load');
  const loadB = await B.waitFor('load');
  check('两人都收到 load(关卡 3)', loadA.level === 3 && loadB.level === 3);
  check('load 带 3.5 秒倒计时 t0', Math.abs(loadA.t0 - Date.now() - 3500) < 1500, String(loadA.t0));

  // 状态中继
  A.send({ t: 'state', s: { x: 111, y: 222, dir: -1, dead: false, finished: false } });
  const st = await B.waitFor('state');
  check('状态中继到对方', st.role === 'fire' && st.s.x === 111 && st.s.y === 222, JSON.stringify(st));

  // 事件中继
  B.send({ t: 'event', e: { kind: 'gem', id: 5 } });
  const ev = await A.waitFor('event');
  check('事件中继到对方', ev.role === 'water' && ev.e.kind === 'gem' && ev.e.id === 5, JSON.stringify(ev));

  // 过关推进
  A.send({ t: 'done', level: 3 });
  const loadA2 = await A.waitFor('load');
  const loadB2 = await B.waitFor('load');
  check('过关后进入关卡 4', loadA2.level === 4 && loadB2.level === 4);

  // 重复 done 被忽略(旧等级)
  A.send({ t: 'done', level: 3 });
  A.send({ t: 'ping', ts: Date.now() });
  const pong = await A.waitFor('pong');
  check('心跳 pong 返回', typeof pong.sts === 'number');

  // 重启
  A.send({ t: 'restart' });
  const loadA3 = await A.waitFor('load');
  check('restart 重发本关 load', loadA3.level === 4);

  // 断线通知
  B.ws.close();
  const left = await A.waitFor('peer_left');
  check('对方断线收到 peer_left', left.role === 'water');

  // 宽限重连
  const B2 = wsClient();
  await new Promise((r) => { B2.ws.onopen = r; });
  B2.send({ t: 'join', code });
  const joined2 = await B2.waitFor('joined');
  check('15 秒宽限期内可重新加入', joined2.role === 'water');
  const loadA4 = await A.waitFor('load');
  check('重连后重新广播 load', loadA4.level === 4);

  // 错误房间号
  const C = wsClient();
  await new Promise((r) => { C.ws.onopen = r; });
  C.send({ t: 'join', code: 'ZZZZ' });
  const err = await C.waitFor('error');
  check('无效房间号返回错误提示', !!err.msg, JSON.stringify(err));

  A.ws.close(); B2.ws.close(); C.ws.close();
  console.log('----------------------------------------');
  console.log(failed === 0 ? '结果: 全部通过 (' + passed + ' 项)' : '结果: ' + failed + ' 项失败 / ' + passed + ' 项通过');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
