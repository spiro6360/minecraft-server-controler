// 플러그인(WebPanel)과 WebSocket 으로 통신하는 클라이언트.
// request(action, data) → Promise 로 응답을 받고, 서버가 먼저 보내는 실시간 이벤트는 on(event, fn) 으로 받는다.

export class PanelClient {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closedByUser = false;
    this.everConnected = false;
    this.retry = 0;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, data) {
    for (const fn of this.listeners.get(event) || []) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }

  /** 연결 + 로그인. 성공하면 resolve, 토큰이 틀리거나 연결 실패면 reject. */
  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        reject(new Error('서버 주소가 올바르지 않습니다'));
        return;
      }
      this.ws = ws;
      this.emit('connection', 'connecting');

      ws.onopen = () => {
        this.send({ id: 0, action: 'auth', data: { token: this.token } });
      };

      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id === 0 && !settled) {
          settled = true;
          if (msg.ok) {
            this.everConnected = true;
            this.retry = 0;
            this.emit('connection', 'open');
            resolve();
          } else {
            reject(new Error(msg.error || '로그인 실패'));
          }
          return;
        }
        if (msg.event) {
          this.emit(msg.event, msg.data);
          return;
        }
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error || '요청 실패'));
        }
      };

      ws.onclose = (ev) => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('연결이 끊어졌습니다'));
        }
        this.pending.clear();
        if (!settled) {
          settled = true;
          reject(new Error(closeReason(ev)));
          return;
        }
        this.emit('connection', 'closed');
        if (!this.closedByUser && this.everConnected && ev.code !== 1008) this.scheduleReconnect();
      };
    });
  }

  scheduleReconnect() {
    const delay = Math.min(30000, 1000 * 2 ** this.retry++);
    this.emit('connection', 'reconnecting');
    setTimeout(async () => {
      if (this.closedByUser) return;
      try {
        await this.connect();
        this.emit('reconnected');
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  request(action, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('서버에 연결되어 있지 않습니다'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('응답 시간 초과'));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, action, data });
    });
  }

  close() {
    this.closedByUser = true;
    if (this.ws) this.ws.close();
  }
}

function closeReason(ev) {
  switch (ev.reason) {
    case 'invalid token': return '토큰이 올바르지 않습니다';
    case 'too many failed logins': return '로그인 실패가 많아 잠시 차단되었습니다. 나중에 다시 시도하세요';
    case 'origin not allowed': return '이 사이트 주소가 플러그인 config.yml 의 allowed-origins 에 없습니다';
    case 'auth timeout': return '로그인 시간 초과';
  }
  if (location.protocol === 'https:' && /^ws:\/\//i.test(ev.target?.url || '')) {
    return 'https 사이트에서는 ws:// 주소에 연결할 수 없습니다. wss:// 주소(Cloudflare Tunnel 등)를 쓰세요';
  }
  return '서버에 연결할 수 없습니다. 주소, 서버 실행 여부, 터널 상태를 확인하세요';
}
