/* =====================================================================
   LUCKY GRAB — 스마트폰 컨트롤러
   WebSocket 으로 메인 화면의 집게를 실시간 조작합니다.
   ===================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const elPill = $('connPill');
  const elConnText = $('connText');
  const elTurnTitle = $('turnTitle');
  const elTurnSub = $('turnSub');
  const elTurnCard = $('turnCard');
  const elGrab = $('grabBtn');
  const elDpad = $('dpad');
  const elFoot = $('foot');
  const elOverlay = $('overlay');
  const elWinPrize = $('winPrize');
  const elWinSub = $('winSub');
  const elToast = $('toast');
  const elBlocker = $('blocker');
  const elHubText = $('hubText');

  const S = {
    ws: null,
    everConnected: false,
    connected: false,
    phase: 'idle',
    isActive: false,
    ahead: null,
    queueLength: 0,
    controllerCount: 0,
    myGrab: false,
    label: ''
  };

  let myGrabTimer = null;

  /* ---------------------------------------------------------------- toast */
  let toastTimer = null;
  function toast(text, ms) {
    elToast.textContent = text;
    elToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elToast.classList.remove('show'), ms || 2400);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) { /* noop */ }
    }
  }

  /* ------------------------------------------------------------------ net */
  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  }

  function connect() {
    let ws;
    try {
      ws = new WebSocket(wsUrl());
    } catch (e) {
      setTimeout(connect, 2000);
      return;
    }
    S.ws = ws;

    ws.onopen = () => {
      S.connected = true;
      S.everConnected = true;
      ws.send(JSON.stringify({ type: 'hello', role: 'controller' }));
      elBlocker.classList.add('hide');
      render();
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    };

    ws.onclose = () => {
      S.connected = false;
      S.isActive = false;
      releaseAll();
      render();
      if (!S.everConnected) {
        elBlocker.classList.remove('hide');
      } else {
        toast('연결이 끊겨 다시 연결하는 중…', 3000);
      }
      setTimeout(connect, 1500);
    };

    ws.onerror = () => {
      try { ws.close(); } catch (e) { /* noop */ }
    };
  }

  function send(obj) {
    if (S.ws && S.ws.readyState === 1) {
      S.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function handle(msg) {
    switch (msg.type) {
      case 'hello':
        S.label = msg.label || '';
        elFoot.textContent = '꾹 누르고 있으면 집게가 계속 움직여요';
        break;

      case 'state': {
        const wasActive = S.isActive;
        S.phase = msg.phase;
        S.isActive = !!msg.isActive;
        S.ahead = msg.ahead;
        S.queueLength = msg.queueLength || 0;
        S.controllerCount = msg.controllerCount || 0;

        if (!wasActive && S.isActive) {
          vibrate([30, 50, 30]);
          toast('내 차례예요! 집게를 움직여 보세요', 2600);
        }
        if (msg.phase === 'ready' && S.myGrab) S.myGrab = false;
        render();
        break;
      }

      case 'result':
        clearTimeout(myGrabTimer);
        if (S.myGrab) {
          S.myGrab = false;
          showWin(msg.prize, msg.playerLabel);
        } else {
          toast((msg.playerLabel || '누군가') + ' 님이 ' + msg.prize.name + ' 당첨!', 3200);
        }
        break;

      case 'notice':
        toast(msg.text, 4000);
        break;

      case 'pong':
        break;

      default:
        break;
    }
  }

  /* --------------------------------------------------------------- render */
  function render() {
    const active = S.connected && S.isActive;
    const grabbing = active && S.phase === 'grabbing';

    // 상태 배지
    elPill.className = 'pill';
    if (!S.connected) {
      elConnText.textContent = '연결 끊김 · 재연결 중';
    } else if (grabbing) {
      elPill.classList.add('busy');
      elConnText.textContent = '뽑기 진행 중';
    } else if (active) {
      elPill.classList.add('turn');
      elConnText.textContent = '내 차례';
    } else {
      elPill.classList.add('online');
      elConnText.textContent = '연결됨 · 대기 중';
    }

    // 안내 문구
    elTurnTitle.classList.toggle('active', active && !grabbing);
    if (!S.connected) {
      elTurnTitle.textContent = '연결하는 중…';
      elTurnSub.textContent = '메인 화면이 켜져 있는지 확인해 주세요';
    } else if (grabbing) {
      elTurnTitle.textContent = '뽑기 진행 중…';
      elTurnSub.textContent = '집게가 경품을 집어 올리고 있어요';
    } else if (active) {
      elTurnTitle.textContent = '내 차례! 🎯';
      elTurnSub.textContent = '방향키로 집게를 움직이고 GRAB 을 눌러요';
    } else if (S.ahead && S.ahead > 0) {
      elTurnTitle.textContent = '대기 중';
      elTurnSub.textContent = '앞에 ' + S.ahead + '명 · 곧 순서가 옵니다';
    } else {
      elTurnTitle.textContent = '대기 중';
      elTurnSub.textContent = S.controllerCount > 1 ? '다른 분이 뽑는 중이에요' : '잠시만 기다려 주세요';
    }

    // 버튼 활성화
    const canGrab = active && !grabbing;
    elGrab.disabled = !canGrab;
    elGrab.classList.toggle('ready', canGrab && S.phase !== 'result');
    for (const btn of elDpad.querySelectorAll('.dbtn')) {
      btn.disabled = !canGrab;
    }
    elHubText.textContent = activeDirs.size ? '이동 중' : (active ? '조작' : '대기');

    if (!canGrab) releaseAll(true);
  }

  /* ---------------------------------------------------------------- input */
  const DIRS = {    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0]
  };
  const activeDirs = new Set();
  let lastSent = { x: 0, z: 0 };
  let sendTimer = null;

  function currentVector() {
    let x = 0, z = 0;
    for (const d of activeDirs) {
      const v = DIRS[d];
      if (!v) continue;
      x += v[0];
      z += v[1];
    }
    return { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) };
  }

  function pushInput(force) {
    if (!S.connected || !S.isActive || S.phase === 'grabbing') return;
    const v = currentVector();
    if (!force && v.x === lastSent.x && v.z === lastSent.z) return;
    lastSent = v;
    send({ type: 'input', x: v.x, z: v.z });
  }

  function startLoop() {
    stopLoop();
    sendTimer = setInterval(() => pushInput(false), 70);
  }
  function stopLoop() {
    if (sendTimer) clearInterval(sendTimer);
    sendTimer = null;
  }

  function releaseAll(silent) {
    if (!activeDirs.size && !silent) return;
    activeDirs.clear();
    for (const btn of elDpad.querySelectorAll('.dbtn')) btn.classList.remove('active');
    elHubText.textContent = S.isActive ? '조작' : '대기';
    lastSent = { x: 0, z: 0 };
    stopLoop();
    if (!silent) pushInput(true);
    else send({ type: 'input', x: 0, z: 0 });
  }

  for (const btn of elDpad.querySelectorAll('.dbtn')) {
    const dir = btn.dataset.dir;

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      unlockScreen();
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      activeDirs.add(dir);
      btn.classList.add('active');
      elHubText.textContent = '이동 중';
      vibrate(8);
      pushInput(true);
      startLoop();
    });

    const end = (e) => {
      if (!activeDirs.has(dir)) return;
      activeDirs.delete(dir);
      btn.classList.remove('active');
      if (!activeDirs.size) {
        stopLoop();
        elHubText.textContent = S.isActive ? '조작' : '대기';
      }
      pushInput(true);
    };

    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('pointerleave', (e) => {
      // 포인터 캡처가 안 되는 브라우저 대비
      if (e.buttons === 0) end(e);
    });
    btn.addEventListener('lostpointercapture', end);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* GRAB */
  elGrab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (elGrab.disabled) return;
    unlockScreen();
    elGrab.classList.add('pressed');
    vibrate(18);
    if (S.connected && S.isActive && S.phase !== 'grabbing') {
      S.myGrab = true;
      clearTimeout(myGrabTimer);
      myGrabTimer = setTimeout(() => { S.myGrab = false; }, 20000);
      releaseAll(true);
      send({ type: 'grab' });
    }
  });
  const unpressed = () => elGrab.classList.remove('pressed');
  elGrab.addEventListener('pointerup', unpressed);
  elGrab.addEventListener('pointercancel', unpressed);
  elGrab.addEventListener('pointerleave', unpressed);
  elGrab.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

  /* ---------------------------------------------------------------- win UI */
  let winTimer = null;
  function showWin(prize, playerLabel) {
    elWinPrize.textContent = (prize.emoji ? prize.emoji + ' ' : '') + prize.name;
    elWinSub.textContent = (playerLabel ? playerLabel + ' · ' : '') + '축하합니다!';
    elOverlay.classList.add('show');
    vibrate([40, 60, 40, 60, 120]);
    clearTimeout(winTimer);
    winTimer = setTimeout(hideWin, 9000);
  }
  function hideWin() {
    elOverlay.classList.remove('show');
    clearTimeout(winTimer);
  }
  $('winClose').addEventListener('click', hideWin);

  /* ------------------------------------------------------------ wake lock */
  let wakeLock = null;
  async function unlockScreen() {
    try {
      if (!wakeLock && 'wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* noop */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') unlockScreen();
  });

  /* ----------------------------------------------------------------- boot */
  connect();
  setInterval(() => { if (S.connected) send({ type: 'ping', t: Date.now() }); }, 25000);
  window.addEventListener('online', () => { if (!S.connected) connect(); });
})();
