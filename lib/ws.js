'use strict';
/**
 * 아주 작은 WebSocket 서버 (RFC 6455) — 외부 패키지 없이 동작합니다.
 * 텍스트/바이너리 프레임, 분할 프레임, ping/pong, close 를 처리합니다.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1024 * 1024; // 1MB

class WSConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.open = true;
    this.isAlive = true;
    this._buf = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentOpcode = 0;
    this._closing = false;

    try {
      socket.setTimeout(0);
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30000);
    } catch (_) { /* ignore */ }

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._finish());
    socket.on('end', () => this._finish());
    socket.on('error', () => this._finish());
  }

  send(data) {
    if (!this.open) return false;
    const isBuf = Buffer.isBuffer(data);
    const payload = isBuf ? data : Buffer.from(String(data), 'utf8');
    try {
      this.socket.write(this._frame(isBuf ? 0x2 : 0x1, payload));
      return true;
    } catch (e) {
      this._finish();
      return false;
    }
  }

  sendJSON(obj) {
    return this.send(JSON.stringify(obj));
  }

  ping() {
    if (!this.open) return;
    try { this.socket.write(this._frame(0x9, Buffer.alloc(0))); } catch (_) { this._finish(); }
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    this._closing = true;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const b = Buffer.alloc(2 + reasonBuf.length);
    b.writeUInt16BE(code, 0);
    reasonBuf.copy(b, 2);
    try { this.socket.write(this._frame(0x8, b)); } catch (_) { /* ignore */ }
    try { this.socket.end(); } catch (_) { /* ignore */ }
    setTimeout(() => this._finish(), 300).unref?.();
  }

  terminate() {
    try { this.socket.destroy(); } catch (_) { /* ignore */ }
    this._finish();
  }

  _finish() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _frame(opcode, payload) {
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
    header[0] = 0x80 | opcode;
    return Buffer.concat([header, payload]);
  }

  _onData(chunk) {
    if (!this.open) return;
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;

    while (this.open) {
      const frame = this._readFrame();
      if (!frame) break;
      this._handleFrame(frame);
    }
  }

  _readFrame() {
    const buf = this._buf;
    if (buf.length < 2) return null;
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < offset + 2) return null;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(MAX_PAYLOAD)) { this.close(1009, 'too large'); return null; }
      len = Number(big);
      offset += 8;
    }
    if (len > MAX_PAYLOAD) { this.close(1009, 'too large'); return null; }

    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + len) return null;

    let payload = buf.subarray(offset, offset + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    } else {
      payload = Buffer.from(payload);
    }
    this._buf = buf.subarray(offset + len);
    return { fin, opcode, payload };
  }

  _handleFrame({ fin, opcode, payload }) {
    if (opcode === 0x8) { // close
      if (!this._closing) {
        this._closing = true;
        try { this.socket.write(this._frame(0x8, Buffer.alloc(0))); } catch (_) { /* ignore */ }
        try { this.socket.end(); } catch (_) { /* ignore */ }
      }
      setTimeout(() => this._finish(), 100).unref?.();
      return;
    }
    if (opcode === 0x9) { // ping
      try { this.socket.write(this._frame(0xa, payload)); } catch (_) { /* ignore */ }
      return;
    }
    if (opcode === 0xa) { // pong
      this.isAlive = true;
      return;
    }

    if (opcode === 0x0) { // continuation
      this._fragments.push(payload);
      if (fin) {
        const full = Buffer.concat(this._fragments);
        const op = this._fragmentOpcode;
        this._fragments = [];
        this._fragmentOpcode = 0;
        this._deliver(op, full);
      }
      return;
    }

    if (opcode === 0x1 || opcode === 0x2) {
      if (!fin) {
        this._fragmentOpcode = opcode;
        this._fragments = [payload];
        return;
      }
      this._deliver(opcode, payload);
    }
  }

  _deliver(opcode, payload) {
    this.isAlive = true;
    this.emit('message', payload, opcode === 0x2);
  }
}

class WebSocketServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.clients = new Set();
    this._heartbeat = setInterval(() => this._checkAlive(), options.heartbeatMs || 30000);
    this._heartbeat.unref?.();
  }

  _checkAlive() {
    for (const ws of this.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }

  handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + accept,
      '\r\n'
    ];
    socket.write(headers.join('\r\n'));

    const ws = new WSConnection(socket, req);
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    this.emit('connection', ws, req);
    if (head && head.length) ws._onData(head);
  }

  close() {
    clearInterval(this._heartbeat);
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
  }
}

module.exports = { WebSocketServer, WSConnection };
