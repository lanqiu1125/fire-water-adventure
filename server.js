/**
 * 冰火小冒险 —— 联机服务器(零依赖,内置 WebSocket 协议实现)
 *
 * 运行:  node server.js
 * 特点:  一个进程同时提供网页(public/)与 WebSocket 联机服务,
 *        部署到任何支持 Node 的服务器(Render / Railway / VPS 等)即可实现全网联机。
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 16 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2'
};

/* ---------------- WebSocket 帧编码(服务端→客户端,不掩码) ---------------- */
function encodeFrame(opcode, payload) {
  payload = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

/* ---------------- WebSocket 连接封装 ---------------- */
class WsConnection {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.fragOpcode = 0;
    this.msgLen = 0;
    this.closed = false;
    this.alive = true;
    this.states = 0; // 限速计数
    this.room = null;
    this.role = null;
    this.onmessage = null;
    this.onclose = null;
    sock.on('data', (chunk) => this.onData(chunk));
    sock.on('close', () => { this.closed = true; if (this.onclose) this.onclose(); });
    sock.on('error', () => {});
  }
  onData(chunk) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (!this.closed) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (!masked) { this.close(1002, 'unmasked'); return; } // 客户端帧必须带掩码
      if (len > MAX_PAYLOAD) { this.close(1009, 'too large'); return; }
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = this.buf[off + 4 + i] ^ mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.handleFrame(fin, opcode, payload);
    }
  }
  handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) { this.close(1000); return; }           // close
    if (opcode === 0x9) { this.sendFrame(0xA, payload); return; } // ping -> pong
    if (opcode === 0xA) { this.alive = true; return; }            // pong
    if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) {
      if (opcode !== 0x0) { this.fragOpcode = opcode; this.frag = []; this.msgLen = 0; }
      this.frag.push(payload);
      this.msgLen += payload.length;
      if (this.msgLen > MAX_PAYLOAD) { this.close(1009, 'too large'); return; }
      if (fin) {
        const full = Buffer.concat(this.frag);
        this.frag = [];
        if (this.fragOpcode === 0x1 && this.onmessage) {
          try { this.onmessage(full.toString('utf8')); } catch (e) {}
        }
      }
    }
  }
  sendFrame(opcode, payload) {
    if (this.closed) return;
    try { this.sock.write(encodeFrame(opcode, payload)); } catch (e) {}
  }
  send(obj) { this.sendFrame(0x1, JSON.stringify(obj)); }
  ping() { this.sendFrame(0x9, Buffer.alloc(1)); }
  close(code = 1000) {
    if (this.closed) return;
    try { this.sock.write(encodeFrame(0x8, Buffer.alloc(0))); } catch (e) {}
    this.closed = true;
    try { this.sock.end(); this.sock.destroy(); } catch (e) {}
  }
}

/* ---------------- 房间管理 ---------------- */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
function makeCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}

/** room: { code, level, t0, clients:{fire,water}, pendingLeave:{fire,water}, createdAt } */
const rooms = new Map();

function allConns() {
  const out = [];
  for (const r of rooms.values()) {
    for (const role of ['fire', 'water']) if (r.clients[role]) out.push(r.clients[role]);
  }
  return out;
}

function broadcastLoad(room) {
  room.t0 = Date.now() + 3500;
  const msg = { t: 'load', level: room.level, t0: room.t0 };
  for (const role of ['fire', 'water']) {
    const c = room.clients[role];
    if (c) c.send(msg);
  }
}

function destroyRoom(code) {
  const r = rooms.get(code);
  if (!r) return;
  for (const role of ['fire', 'water']) {
    const c = r.clients[role];
    if (c) { c.onclose = null; c.close(4001); }
  }
  rooms.delete(code);
}

function onLeave(conn) {
  if (!conn.room) return;
  const r = rooms.get(conn.room);
  if (!r) return;
  const role = conn.role;
  if (r.clients[role] === conn) r.clients[role] = null;
  const other = role === 'fire' ? 'water' : 'fire';
  const peer = r.clients[other];
  if (peer) peer.send({ t: 'peer_left', role });
  // 15 秒宽限期,允许断线重连;之后若房间空了就销毁
  if (r.pendingLeave[role]) clearTimeout(r.pendingLeave[role]);
  r.pendingLeave[role] = setTimeout(() => {
    delete r.pendingLeave[role];
    if (!r.clients.fire && !r.clients.water) destroyRoom(r.code);
  }, 15000);
}

function handleMessage(conn, text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;
  const room = conn.room ? rooms.get(conn.room) : null;

  switch (m.t) {
    case 'ping':
      conn.send({ t: 'pong', ts: m.ts || 0, sts: Date.now() });
      return;

    case 'create': {
      const level = Math.max(1, Math.min(999, parseInt(m.level, 10) || 1));
      const code = makeCode();
      rooms.set(code, {
        code, level,
        t0: 0,
        clients: { fire: conn, water: null },
        pendingLeave: {},
        createdAt: Date.now()
      });
      conn.room = code;
      conn.role = 'fire';
      conn.send({ t: 'created', code, role: 'fire', level });
      console.log(`[${new Date().toLocaleTimeString()}] 创建房间 ${code} (关卡 ${level})`);
      return;
    }

    case 'join': {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
      const r = rooms.get(code);
      if (!r) { conn.send({ t: 'error', msg: '没有找到这个房间,检查一下房间号吧~' }); return; }
      let role = null;
      if (!r.clients.fire) role = 'fire';
      else if (!r.clients.water) role = 'water';
      if (!role) { conn.send({ t: 'error', msg: '房间已经满员啦!' }); return; }
      conn.room = r.code;
      conn.role = role;
      r.clients[role] = conn;
      if (r.pendingLeave[role]) { clearTimeout(r.pendingLeave[role]); delete r.pendingLeave[role]; }
      const peerRole = role === 'fire' ? 'water' : 'fire';
      conn.send({ t: 'joined', role, level: r.level, peer: !!r.clients[peerRole] });
      if (r.clients.fire && r.clients.water) broadcastLoad(r);
      console.log(`[${new Date().toLocaleTimeString()}] ${role} 加入房间 ${r.code}`);
      return;
    }

    case 'state': { // 角色状态转发(客户端权威 + 服务器中继)
      if (!room || !conn.role) return;
      conn.states++;
      if (conn.states > 90) { conn.close(1008, 'rate limit'); return; }
      const other = conn.role === 'fire' ? 'water' : 'fire';
      const peer = room.clients[other];
      if (peer) peer.send({ t: 'state', role: conn.role, s: m.s });
      return;
    }

    case 'event': { // 事件中继(宝石、死亡、过关等)
      if (!room || !conn.role) return;
      const other = conn.role === 'fire' ? 'water' : 'fire';
      const peer = room.clients[other];
      if (peer) peer.send({ t: 'event', role: conn.role, e: m.e });
      return;
    }

    case 'done': { // 过关 → 服务器推进关卡(带等级校验,防重复触发)
      if (!room) return;
      if ((parseInt(m.level, 10) || 0) === room.level) {
        room.level++;
        broadcastLoad(room);
        console.log(`[${new Date().toLocaleTimeString()}] 房间 ${room.code} 进入关卡 ${room.level}`);
      }
      return;
    }

    case 'restart':
      if (room) broadcastLoad(room);
      return;

    case 'pick': { // 房主选关
      if (!room || conn.role !== 'fire') return;
      room.level = Math.max(1, Math.min(999, parseInt(m.level, 10) || 1));
      if (room.clients.fire && room.clients.water) broadcastLoad(room);
      return;
    }
  }
}

/* ---------------- HTTP 静态服务 + 升级 ---------------- */
const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { urlPath = '/'; }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 - 页面不存在');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || !req.headers.upgrade || req.headers.upgrade.toLowerCase() !== 'websocket') {
    sock.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  const conn = new WsConnection(sock);
  conn.onmessage = (text) => handleMessage(conn, text);
  conn.onclose = () => onLeave(conn);
});

/* ---------------- 心跳与限速 ---------------- */
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (now - r.createdAt > 6 * 3600 * 1000) destroyRoom(r.code); // 6 小时回收
  }
  for (const c of allConns()) {
    if (!c.alive) { c.close(4000); continue; }
    c.alive = false;
    c.ping();
  }
}, 30000);

setInterval(() => { for (const c of allConns()) c.states = 0; }, 1000);

/* ---------------- 启动 ---------------- */
server.listen(PORT, '0.0.0.0', () => {
  console.log('==========================================');
  console.log('  🔥💧 冰火小冒险 联机服务器已启动!');
  console.log(`  本机访问:   http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) {
        console.log(`  局域网访问: http://${n.address}:${PORT}  (手机连同一 WiFi 即可)`);
      }
    }
  }
  console.log('  提示: 要实现「无距离限制」的联机,请把本目录部署到公网服务器');
  console.log('        (免费方案: Render / Railway 等,详见 README.md)');
  console.log('==========================================');
});

process.on('SIGINT', () => { console.log('\n服务器已停止,再见~'); process.exit(0); });
