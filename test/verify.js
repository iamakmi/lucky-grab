'use strict';
/* 간단한 자체 점검 스크립트:  node test/verify.js  (서버가 켜져 있어야 합니다) */
const http = require('http');

const PORT = process.env.PORT || process.argv[2] || 3000;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + path, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

function openSocket(role) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const messages = [];
    const waiters = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].type === msg.type && (!waiters[i].pred || waiters[i].pred(msg))) {
          const w = waiters.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(msg);
        }
      }
    });
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role }));
      resolve({
        ws,
        messages,
        send: (o) => ws.send(JSON.stringify(o)),
        waitFor(type, ms = 5000, pred = null) {
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.type === type && (!pred || pred(m))) return Promise.resolve(m);
          }
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(type + ' timeout')), ms);
            waiters.push({ type, pred, resolve: res, timer });
          });
        },
        close: () => ws.close()
      });
    });
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n🔎 LUCKY GRAB 자체 점검 (' + BASE + ')\n');

  /* --- HTTP --- */
  const home = await get('/');
  ok('메인 화면 / 응답', home.status === 200 && home.body.includes('LUCKY'), 'status ' + home.status);

  const ctrl = await get('/controller');
  ok('컨트롤러 /controller 응답', ctrl.status === 200 && ctrl.body.includes('GRAB'), 'status ' + ctrl.status);

  const css = await get('/css/display.css');
  ok('CSS 파일 응답', css.status === 200 && css.body.includes('.qr-panel'));

  const js = await get('/js/display.js');
  ok('디스플레이 스크립트 응답', js.status === 200 && js.body.includes('drawScene'));

  const qrlib = await get('/vendor/qrcode.js');
  ok('QR 라이브러리 응답', qrlib.status === 200);

  const cfgRes = await get('/api/config');
  let cfg = null;
  try { cfg = JSON.parse(cfgRes.body); } catch (e) { /* noop */ }
  ok('/api/config JSON', cfgRes.status === 200 && cfg && Array.isArray(cfg.prizes) && cfg.prizes.length > 0);
  ok('컨트롤러 주소 포함', !!(cfg && cfg.urls && (cfg.urls.lan || cfg.urls.local)), JSON.stringify(cfg && cfg.urls));
  ok('QR용 접속 주소 형식', !!(cfg && cfg.urls && cfg.urls.local.endsWith('/controller')));

  const nf = await get('/nope');
  ok('없는 경로 404', nf.status === 404);

  const trav = await get('/../server.js');
  ok('상위 경로 접근 차단', trav.status === 404 || trav.status === 403, 'status ' + trav.status);

  /* --- WebSocket --- */
  const display = await openSocket('display');
  const dHello = await display.waitFor('hello');
  ok('디스플레이 접속 · hello 수신', dHello.role === 'display' && dHello.config.prizes.length > 0);

  const controller = await openSocket('controller');
  const cHello = await controller.waitFor('hello');
  ok('컨트롤러 접속 · hello 수신', cHello.role === 'controller' && !!cHello.label, cHello.label);

  await sleep(200);
  const cState = await controller.waitFor('state');
  ok('내 차례 판정 (isActive)', cState.isActive === true && cState.ahead === 0);
  ok('연결 수 집계', cState.controllerCount === 1, 'count=' + cState.controllerCount);

  const dState = await display.waitFor('state', 4000, (m) => m.controllerCount === 1);
  ok('디스플레이가 컨트롤러 수를 받음', dState.controllerCount === 1);

  /* 입력 중계 */
  controller.send({ type: 'input', x: 1, z: -1 });
  const relay = await display.waitFor('input');
  ok('이동 입력 실시간 중계', relay.x === 1 && relay.z === -1);

  /* 뽑기 */
  const before = (await get('/healthz'));
  const beforePrizes = JSON.parse(before.body).prizes;
  const beforeTotal = beforePrizes.reduce((s, p) => s + p.remaining, 0);

  controller.send({ type: 'grab' });
  const grabStart = await display.waitFor('grab_start');
  ok('grab_start 수신 (경품 결정)', !!grabStart.prize && !!grabStart.prize.name, grabStart.prize && grabStart.prize.name);
  const grabbingState = await controller.waitFor('state', 4000, (m) => m.phase === 'grabbing');
  ok('뽑기 진행 상태 전달', !!grabbingState);

  display.send({ type: 'grab_done' });
  const result = await controller.waitFor('result');
  ok('결과(result) 수신', result.prize.id === grabStart.prize.id);

  await sleep(300);
  const afterPrizes = JSON.parse((await get('/healthz')).body).prizes;
  const afterTotal = afterPrizes.reduce((s, p) => s + p.remaining, 0);
  ok('재고 차감 반영', afterTotal === beforeTotal - 1, `${beforeTotal} → ${afterTotal}`);

  /* 두 번째 사람 대기열 */
  const c2 = await openSocket('controller');
  await c2.waitFor('hello');
  await sleep(300);
  const c2State = await c2.waitFor('state');
  ok('두 번째 참가자 대기열', c2State.isActive === false && c2State.ahead >= 1, 'ahead=' + c2State.ahead);

  /* 턴 넘김 확인 (약 3.4초 뒤) */
  await sleep(3800);
  const c2State2 = await c2.waitFor('state', 4000).catch(() => null);
  const last = c2.messages[c2.messages.length - 1];
  ok('다음 사람에게 차례 넘어감', last && last.phase === 'ready' && last.isActive === true, JSON.stringify(last && { phase: last.phase, active: last.isActive }));

  display.close();
  controller.close();
  c2.close();

  console.log('\n──────────────────────────────');
  console.log(`  결과: ${pass}개 통과, ${fail}개 실패\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\n❌ 점검 중 오류:', err.message, '\n');
  process.exit(1);
});
