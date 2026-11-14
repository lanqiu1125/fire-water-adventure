/**
 * 冰火小冒险 —— 联机客户端(WebSocket)
 * 协议见 server.js:创建/加入房间、状态中继、事件中继、过关推进、断线宽限重连
 */
(function (root) {
  function defaultUrl() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return proto + location.host;
  }

  class Net {
    constructor() {
      this.ws = null;
      this.url = '';
      this.role = null;          // fire | water
      this.roomCode = '';
      this.connected = false;
      this.rtt = 0;
      this.clockOffset = 0;      // 服务器时间 - 本地时间
      this.handlers = {};
      this._pingTimer = null;
      this._stateTimer = null;
      this._lastState = null;
      this._throttle = 0;
    }

    get serverTime() { return Date.now() + this.clockOffset; }

    on(type, fn) { this.handlers[type] = fn; }
    emit(type, data) { if (this.handlers[type]) this.handlers[type](data); }

    connect(url, cb) {
      this.url = url || defaultUrl();
      this.close();
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        cb && cb(new Error('无法连接服务器'));
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this._startPing();
        cb && cb(null);
      };
      ws.onmessage = (ev) => this._onMessage(ev.data);
      ws.onclose = () => {
        this.connected = false;
        this._stopTimers();
        this.emit('close', {});
      };
      ws.onerror = () => {
        this.connected = false;
        this._stopTimers();
        cb && cb(new Error('连接失败'));
        this.emit('close', {});
      };
    }

    close() {
      this._stopTimers();
      if (this.ws) {
        try { this.ws.onclose = null; this.ws.close(); } catch (e) {}
        this.ws = null;
      }
      this.connected = false;
    }

    _startPing() {
      this._pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === 1) {
          this._send({ t: 'ping', ts: Date.now() });
        }
      }, 4000);
    }
    _stopTimers() {
      if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
      if (this._stateTimer) { clearInterval(this._stateTimer); this._stateTimer = null; }
    }

    _send(obj) {
      if (this.ws && this.ws.readyState === 1) {
        try { this.ws.send(JSON.stringify(obj)); } catch (e) {}
      }
    }

    _onMessage(raw) {
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      switch (m.t) {
        case 'pong': {
          const rtt = Date.now() - (m.ts || 0);
          this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
          this.clockOffset = (m.sts + rtt / 2) - Date.now();
          break;
        }
        case 'created':
        case 'joined': {
          this.role = m.role;
          this.roomCode = m.code;
          this.emit('room', { role: m.role, code: m.code, level: m.level, peer: !!m.peer });
          break;
        }
        case 'load':
          this.emit('load', { level: m.level, t0: m.t0 });
          break;
        case 'state':
          this.emit('state', { role: m.role, s: m.s });
          break;
        case 'event':
          this.emit('event', { role: m.role, e: m.e });
          break;
        case 'peer_left':
          this.emit('peer_left', { role: m.role });
          break;
        case 'error':
          this.emit('error', { msg: m.msg });
          break;
      }
    }

    createRoom(level) { this._send({ t: 'create', level }); }
    joinRoom(code) { this._send({ t: 'join', code }); }
    pickLevel(level) { this._send({ t: 'pick', level }); }

    /** 20Hz 发送自己角色状态 */
    sendState(s) {
      this._lastState = s;
      const now = performance.now();
      if (now < this._throttle) return;
      this._throttle = now + 50;
      this._send({ t: 'state', s });
    }
    flushState() { if (this._lastState) this._send({ t: 'state', s: this._lastState }); }
    sendEvent(e) { this._send({ t: 'event', e }); }
    done(level) { this._send({ t: 'done', level }); }
    restart() { this._send({ t: 'restart' }); }
  }

  root.FWF = root.FWF || {};
  root.FWF.Net = Net;
})(typeof window !== 'undefined' ? window : globalThis);
