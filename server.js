'use strict';
/**
 * LUCKY GRAB — QR 스마트폰 컨트롤러 럭키드로우(인형뽑기) 서버
 * 외부 패키지 0개. `npm start` 만으로 실행됩니다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('./lib/ws');
const qrcode = require('./public/vendor/qrcode.js');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'prize-state.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BASE_PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_TRIES = 12;

const DEFAULT_SETTINGS = {
  fontScale: 100,          // 70 ~ 160 (%)
  qrPosition: 'right',     // right | bottom-right | bottom-left | top-right | top-left | bottom-center
  qrSize: 100,             // 70 ~ 140 (%)
  qrVisible: true
};

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return Object.assign({}, DEFAULT_SETTINGS, raw || {});
  } catch (_) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

let uiSettings = loadSettings();

function saveSettings(patch) {
  const next = Object.assign({}, uiSettings);
  if (patch && typeof patch === 'object') {
    if (patch.fontScale != null && isFinite(Number(patch.fontScale))) {
      next.fontScale = Math.min(160, Math.max(70, Math.round(Number(patch.fontScale))));
    }
    if (['right', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'bottom-center'].includes(patch.qrPosition)) {
      next.qrPosition = patch.qrPosition;
    }
    if (patch.qrSize != null && isFinite(Number(patch.qrSize))) {
      next.qrSize = Math.min(140, Math.max(70, Math.round(Number(patch.qrSize))));
    }
    if (typeof patch.qrVisible === 'boolean') next.qrVisible = patch.qrVisible;
  }
  uiSettings = next;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(uiSettings, null, 2));
  } catch (err) {
    console.warn('⚠️  설정을 저장하지 못했습니다:', err.message);
  }
  return uiSettings;
}

/* ------------------------------------------------------------------ */
/* 설정 불러오기                                                       */
/* ------------------------------------------------------------------ */

const PALETTE = ['#22d3ee', '#a78bfa', '#f472b6', '#f59e0b', '#34d399', '#60a5fa', '#fb7185', '#facc15'];

function loadConfig() {
  const file = path.join(ROOT, 'prizes.json');
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('⚠️  prizes.json 을 읽지 못했습니다 (' + err.message + '). 기본 경품으로 실행합니다.');
  }
  const list = Array.isArray(raw.prizes) ? raw.prizes : [];
  const prizes = list.map((p, i) => ({
    id: String(p.id || 'prize-' + (i + 1)),
    name: String(p.name || '경품 ' + (i + 1)),
    color: /^#[0-9a-fA-F]{3,8}$/.test(String(p.color || '')) ? p.color : PALETTE[i % PALETTE.length],
    emoji: typeof p.emoji === 'string' ? p.emoji : '',
    weight: Math.max(0, Number(p.weight) || 0),
    quantity: Math.max(0, Math.floor(Number(p.quantity) || 0))
  })).filter((p) => p.weight > 0 || p.quantity > 0);

  if (!prizes.length) {
    prizes.push(
      { id: 'default-1', name: '럭키 상품 A', color: '#22d3ee', emoji: '🎁', weight: 1, quantity: 10 },
      { id: 'default-2', name: '럭키 상품 B', color: '#f472b6', emoji: '🎀', weight: 1, quantity: 10 }
    );
  }

  return {
    title: typeof raw.title === 'string' ? raw.title : 'LUCKY GRAB',
    subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : 'QR로 조작하는 럭키드로우',
    grabDurationMs: Math.max(2000, Number(raw.grabDurationMs) || 6000),
    prizes
  };
}

const config = loadConfig();

/* 재고 상태 저장/복원 (서버를 껐다 켜도 남은 수량 유지) */
function loadState() {
  const map = new Map();
  for (const p of config.prizes) map.set(p.id, p.quantity);
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const p of config.prizes) {
      const s = saved && saved.prizes && saved.prizes[p.id];
      if (s && s.quantity === p.quantity && Number.isFinite(s.remaining)) {
        map.set(p.id, Math.max(0, Math.min(p.quantity, s.remaining)));
      }
    }
  } catch (_) { /* 첫 실행 */ }
  return map;
}

const remaining = loadState();

function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = { savedAt: new Date().toISOString(), prizes: {} };
    for (const p of config.prizes) out.prizes[p.id] = { quantity: p.quantity, remaining: remaining.get(p.id) ?? 0 };
    fs.writeFileSync(STATE_FILE, JSON.stringify(out, null, 2));
  } catch (err) {
    console.warn('⚠️  재고 상태를 저장하지 못했습니다:', err.message);
  }
}

function publicPrizes() {
  return config.prizes.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    emoji: p.emoji,
    remaining: remaining.get(p.id) ?? 0,
    quantity: p.quantity
  }));
}

/* ------------------------------------------------------------------ */
/* 네트워크 주소                                                       */
/* ------------------------------------------------------------------ */

function lanAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      let score = 0;
      if (/^192\.168\./.test(a.address)) score += 30;
      else if (/^10\./.test(a.address)) score += 25;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 20;
      else score += 5;
      if (/^(en|eth|wl|wlan|wifi|Wi-Fi)/i.test(name)) score += 10;
      if (/^(docker|veth|br-|virbr|vmnet|utun|tun|tap|lo)/i.test(name)) score -= 20;
      candidates.push({ name, address: a.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0] : null;
}

const LAN = lanAddress();
const localhostUrl = (port) => `http://localhost:${port}`;
const lanUrl = (port) => (LAN ? `http://${LAN.address}:${port}` : null);

/* ------------------------------------------------------------------ */
/* 정적 파일 서버                                                      */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': data.length
    });
    res.end(data);
  });
}

function safeJoin(dir, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.normalize(path.join(dir, rel));
  if (!full.startsWith(dir)) return null;
  return full;
}

/* ------------------------------------------------------------------ */
/* 게임 상태                                                           */
/* ------------------------------------------------------------------ */

let port = BASE_PORT;

const game = {
  phase: 'idle',        // idle | ready | grabbing | result
  queue: [],            // controller client ids (첫 번째가 조작 담당)
  activeId: null,
  currentPrize: null,
  grabTimer: null,
  resultTimer: null,
  lastResult: null,
  round: 0
};

const clients = new Map(); // id -> client
let controllerSeq = 0;

function activeClient() {
  return game.activeId ? clients.get(game.activeId) : null;
}

function activeLabel() {
  const c = activeClient();
  return c ? c.label : null;
}

function queuePositionOf(id) {
  const idx = game.queue.indexOf(id);
  return idx < 0 ? null : idx; // 0 = 내 차례
}

function stateFor(client) {
  const isController = client.role === 'controller';
  const pos = isController ? queuePositionOf(client.id) : null;
  return {
    type: 'state',
    phase: game.phase,
    controllerCount: controllerCount(),
    activeLabel: activeLabel(),
    isActive: isController && game.activeId === client.id,
    ahead: pos === null ? null : Math.max(0, pos),
    queueLength: game.queue.length,
    prizes: publicPrizes(),
    lastResult: game.lastResult,
    round: game.round
  };
}

function controllerCount() {
  let n = 0;
  for (const c of clients.values()) if (c.role === 'controller') n++;
  return n;
}

function send(client, msg) {
  if (client && client.ws && client.ws.open) client.ws.sendJSON(msg);
}

function broadcast(msg, filter) {
  for (const c of clients.values()) {
    if (filter && !filter(c)) continue;
    send(c, msg);
  }
}

function broadcastState() {
  for (const c of clients.values()) {
    if (!c.ready) continue;
    send(c, stateFor(c));
  }
}

function broadcastPrizes() {
  broadcast({ type: 'prizes', prizes: publicPrizes() });
}

/* --- 경품 추첨: 남은 수량이 있는 경품 중 weight 비율로 --- */
function pickPrize() {
  const available = config.prizes
    .map((p) => ({ p, left: remaining.get(p.id) ?? 0 }))
    .filter((x) => x.left > 0 && x.p.weight > 0);
  if (!available.length) return null;
  const total = available.reduce((s, x) => s + x.p.weight, 0);
  let r = Math.random() * total;
  for (const x of available) {
    r -= x.p.weight;
    if (r <= 0) return x.p;
  }
  return available[available.length - 1].p;
}

function prizePayload(p) {
  return { id: p.id, name: p.name, color: p.color, emoji: p.emoji };
}

function startGrab(playerId) {
  if (game.phase !== 'ready' && game.phase !== 'idle') return;
  const prize = pickPrize();
  if (!prize) {
    broadcast({ type: 'notice', text: '모든 경품이 소진되었습니다. prizes.json 에서 수량을 늘려 주세요.' });
    return;
  }
  game.round += 1;
  game.phase = 'grabbing';
  game.currentPrize = prize;
  game.lastResult = null;

  broadcast({
    type: 'grab_start',
    playerId,
    playerLabel: playerId === 'local' ? 'PC 테스트' : activeLabel(),
    prize: prizePayload(prize),
    round: game.round,
    durationMs: config.grabDurationMs
  });
  broadcastState();

  clearTimeout(game.grabTimer);
  // 디스플레이가 응답하지 않아도 진행이 막히지 않도록 안전장치
  game.grabTimer = setTimeout(() => resolveGrab('timeout'), config.grabDurationMs * 2);
}

function resolveGrab(reason) {
  if (game.phase !== 'grabbing') return;
  clearTimeout(game.grabTimer);
  game.grabTimer = null;

  const prize = game.currentPrize;
  const left = remaining.get(prize.id) ?? 0;
  if (left > 0) remaining.set(prize.id, left - 1);
  saveState();

  game.phase = 'result';
  game.currentPrize = null;
  game.lastResult = {
    prize: prizePayload(prize),
    playerLabel: game.activeId ? activeLabel() : 'PC 테스트',
    at: Date.now(),
    round: game.round
  };

  broadcast({ type: 'result', prize: prizePayload(prize), playerLabel: game.lastResult.playerLabel, prizes: publicPrizes(), round: game.round });
  broadcastState();
  broadcastPrizes();

  clearTimeout(game.resultTimer);
  game.resultTimer = setTimeout(() => {
    rotateTurn();
  }, 3400);

  if (reason === 'timeout') console.log('ℹ️  디스플레이 응답이 없어 자동으로 결과를 확정했습니다.');
}

function rotateTurn() {
  clearTimeout(game.resultTimer);
  game.resultTimer = null;
  game.phase = 'idle';
  game.currentPrize = null;

  // 조작이 끝난 사람은 줄 맨 뒤로 (공정한 순서)
  if (game.activeId && game.queue.length > 1) {
    const idx = game.queue.indexOf(game.activeId);
    if (idx >= 0) {
      game.queue.splice(idx, 1);
      game.queue.push(game.activeId);
    }
  }
  // 접속이 끊긴 사람 정리
  game.queue = game.queue.filter((id) => clients.get(id)?.role === 'controller');

  game.activeId = game.queue[0] || null;
  game.phase = game.activeId ? 'ready' : 'idle';
  broadcastState();
}

/* ------------------------------------------------------------------ */
/* WebSocket                                                           */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ heartbeatMs: 25000 });

wss.on('connection', (ws) => {
  const id = 'c-' + crypto.randomBytes(4).toString('hex');
  const client = { id, ws, role: null, ready: false, label: '플레이어' };
  clients.set(id, client);
  ws.isAlive = true;

  const helloTimer = setTimeout(() => {
    if (!client.ready) ws.close(1008, 'hello timeout');
  }, 8000);

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch (_) { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'hello') {
      client.role = msg.role === 'controller' ? 'controller' : 'display';

      if (client.role === 'controller') {
        controllerSeq += 1;
        client.label = '플레이어 ' + controllerSeq;
        game.queue.push(id);
        if (!game.activeId) {
          game.activeId = id;
          if (game.phase === 'idle') game.phase = 'ready';
        }
      }
      client.ready = true;
      clearTimeout(helloTimer);

      send(client, {
        type: 'hello',
        id,
        role: client.role,
        label: client.label,
        config: {
          title: config.title,
          subtitle: config.subtitle,
          grabDurationMs: config.grabDurationMs,
          prizes: publicPrizes(),
          settings: uiSettings,
          urls: {
            local: `http://localhost:${port}/controller`,
            lan: LAN ? `http://${LAN.address}:${port}/controller` : null,
            display: `http://localhost:${port}/`
          }
        }
      });
      send(client, stateFor(client));
      broadcastState();
      console.log(`🔌 ${client.role === 'controller' ? '📱 컨트롤러' : '🖥️  디스플레이'} 접속 (${client.label}) · 현재 컨트롤러 ${controllerCount()}대`);
      return;
    }

    if (msg.type === 'input') {
      if (client.role !== 'controller' || game.activeId !== id) return;
      if (game.phase !== 'ready') return;
      const x = Math.max(-1, Math.min(1, Number(msg.x) || 0));
      const z = Math.max(-1, Math.min(1, Number(msg.z) || 0));
      broadcast({ type: 'input', x, z, playerId: id }, (c) => c.role === 'display');
      return;
    }

      if (client.role === 'display' && msg.type === 'settings') {
        const updated = saveSettings(msg.settings || msg);
        broadcast({ type: 'settings', settings: updated }, (c) => c.role === 'display');
        return;
      }

      if (client.role === 'display' && msg.resetStock === true) {
        for (const p of config.prizes) remaining.set(p.id, p.quantity);
        saveState();
        broadcastPrizes();
        broadcastState();
        return;
      }

      if (msg.type === 'grab') {
        if (game.phase !== 'ready' && game.phase !== 'idle') return;
        if (client.role === 'controller') {
          if (game.activeId !== id) return;
          startGrab(id);
        } else if (client.role === 'display') {
          startGrab('local');
        }
        return;
      }

    if (msg.type === 'grab_done') {
      if (client.role === 'display') resolveGrab('display');
      return;
    }

    if (msg.type === 'ping') {
      send(client, { type: 'pong', t: msg.t || Date.now() });
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    clients.delete(id);
    const wasActive = game.activeId === id;
    game.queue = game.queue.filter((q) => q !== id);

    if (game.phase === 'grabbing' && wasActive) {
      // 조작자가 사라져도 진행 중인 뽑기는 마무리
    } else if (wasActive) {
      game.activeId = game.queue[0] || null;
      game.phase = game.activeId ? 'ready' : 'idle';
    }
    broadcastState();
    if (client.role) console.log(`🔌 접속 종료 (${client.label}) · 남은 컨트롤러 ${controllerCount()}대`);
  });
});

/* ------------------------------------------------------------------ */
/* HTTP 서버                                                           */
/* ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  if (pathname === '/api/config') {
    const body = JSON.stringify({
      title: config.title,
      subtitle: config.subtitle,
      grabDurationMs: config.grabDurationMs,
      prizes: publicPrizes(),
      settings: uiSettings,
      lanUrl: lanUrl(port),
      localUrl: localhostUrl(port),
      controllerPath: '/controller',
      urls: {
        local: localhostUrl(port) + '/controller',
        lan: lanUrl(port) ? lanUrl(port) + '/controller' : null,
        display: localhostUrl(port) + '/'
      },
      serverTime: new Date().toISOString()
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, phase: game.phase, controllers: controllerCount(), prizes: publicPrizes() }));
    return;
  }

  if (pathname === '/' || pathname === '/index.html' || pathname === '/display' || pathname === '/display/') {
    sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }
  if (pathname === '/controller' || pathname === '/controller/' || pathname === '/controller.html') {
    sendFile(res, path.join(PUBLIC_DIR, 'controller.html'));
    return;
  }
  if (pathname === '/favicon.ico') {
    sendFile(res, path.join(PUBLIC_DIR, 'favicon.svg'));
    return;
  }
  if (pathname === '/prizes.json') {
    sendFile(res, path.join(ROOT, 'prizes.json'));
    return;
  }

  const file = safeJoin(PUBLIC_DIR, pathname);
  if (!file) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    sendFile(res, file);
  });
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    tryNextPort();
    return;
  }
  console.error('서버 오류:', err);
});

/* ------------------------------------------------------------------ */
/* 실행                                                                */
/* ------------------------------------------------------------------ */

let portTries = 0;
function listen(p) {
  port = p;
  server.listen(p, '0.0.0.0');
}

function tryNextPort() {
  portTries += 1;
  if (portTries > MAX_PORT_TRIES) {
    console.error(`❌ ${BASE_PORT}~${BASE_PORT + MAX_PORT_TRIES} 포트가 모두 사용 중입니다. PORT 환경변수로 다른 포트를 지정해 주세요.`);
    process.exit(1);
  }
  console.log(`ℹ️  포트 ${port} 이(가) 사용 중입니다. ${port + 1} 번으로 다시 시도합니다…`);
  setTimeout(() => listen(port + 1), 120);
}

server.on('listening', () => {
  const lan = lanUrl(port);
  const controllerUrl = lan ? lan + '/controller' : localhostUrl(port) + '/controller';

  const line = '─'.repeat(58);
  console.log('\n' + line);
  console.log('  🕹️  ' + config.title + '  —  QR 럭키드로우 서버가 켜졌습니다');
  console.log(line);
  console.log('  🖥️  메인(디스플레이) 화면 : ' + localhostUrl(port));
  console.log('  📱 스마트폰 컨트롤러     : ' + controllerUrl);
  if (LAN) console.log('      (같은 와이파이의 스마트폰에서 위 주소로 접속)');
  else console.log('      ⚠️  LAN IP를 찾지 못했습니다. PC와 스마트폰이 같은 와이파이인지 확인하세요.');
  console.log(line);
  console.log('  📷 스마트폰 카메라로 아래 QR 코드를 스캔하세요:\n');
  printQR(controllerUrl);
  console.log('\n  ■ 종료하려면 이 창에서 Ctrl + C 를 누르세요.\n');

  openBrowser(localhostUrl(port));
});

function openBrowser(url) {
  if (process.env.NO_OPEN === '1') return;
  try {
    const { spawn } = require('child_process');
    const platform = process.platform;
    let cmd, args;
    if (platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '""', url]; }
    else if (platform === 'darwin') { cmd = 'open'; args = [url]; }
    else { cmd = 'xdg-open'; args = [url]; }
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch (_) { /* 브라우저 자동 실행은 실패해도 무시 */ }
}

function printQR(text) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const pad = 2;
    // 검은 칸은 ■, 흰 칸은 공백 — Windows/Mac/Linux 콘솔 어디서나 똑같이 보입니다.
    const dark = '██';
    const light = '  ';
    let out = '';
    for (let r = -pad; r < n + pad; r++) {
      let line = '   ';
      for (let c = -pad; c < n + pad; c++) {
        const inside = r >= 0 && r < n && c >= 0 && c < n;
        line += inside && qr.isDark(r, c) ? dark : light;
      }
      out += line + '\n';
    }
    console.log(out);
  } catch (err) {
    console.log('   (QR 코드를 콘솔에 표시하지 못했습니다: ' + err.message + ')');
  }
}

let closing = false;
function shutdown(sig) {
  if (closing) return;
  closing = true;
  console.log(`\n👋 서버를 종료합니다 (${sig}).`);
  clearTimeout(game.grabTimer);
  clearTimeout(game.resultTimer);
  try { wss.close(); } catch (_) { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

listen(BASE_PORT);

module.exports = { serverApp: server };
