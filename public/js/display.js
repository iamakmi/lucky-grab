/* =====================================================================
   LUCKY GRAB — 메인 디스플레이 (순수 Canvas 3D 렌더러)
   외부 라이브러리 없이 원근 투영 + 스프라이트로 입체 인형뽑기를 그립니다.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- utils */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const rand = (a, b) => a + Math.random() * (b - a);
  const nowSec = () => performance.now() / 1000;

  function hexToRgb(hex) {
    let h = String(hex || '#888').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return { r: 136, g: 136, b: 136 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function mixHex(hex, target, t) {
    const a = hexToRgb(hex), b = hexToRgb(target);
    return `rgb(${Math.round(lerp(a.r, b.r, t))},${Math.round(lerp(a.g, b.g, t))},${Math.round(lerp(a.b, b.b, t))})`;
  }
  function rgba(hex, alpha) {
    const c = hexToRgb(hex);
    return `rgba(${c.r},${c.g},${c.b},${alpha})`;
  }

  /* ------------------------------------------------------------------ dom */
  const $ = (id) => document.getElementById(id);
  const scene = $('scene');
  const ctx = scene.getContext('2d');
  const fxCanvas = $('fx');
  const fxc = fxCanvas.getContext('2d');
  const elStatus = $('statusChip');
  const elDot = $('statusDot');
  const elStatusText = $('statusText');
  const elQueue = $('queueText');
  const elQrPanel = $('qrPanel');
  const elQr = $('qrCode');
  const elQrUrl = $('qrUrl');
  const elPrizeList = $('prizeList');
  const elBanner = $('banner');
  const elBannerPrize = $('bannerPrize');
  const elBannerPlayer = $('bannerPlayer');
  const elBannerGlow = $('bannerGlow');
  const elBrandSub = $('brandSub');
  const elKbHint = $('kbHint');

  /* ---------------------------------------------------------------- state */
  const DEFAULT_PRIZES = [
    { id: 'americano', name: '스타벅스 아메리카노', color: '#34d399', emoji: '☕', weight: 30, quantity: 8, remaining: 8 },
    { id: 'cu3000', name: 'CU 모바일 상품권 3천원', color: '#a78bfa', emoji: '🎟️', weight: 25, quantity: 5, remaining: 5 },
    { id: 'baskin', name: '배스킨라빈스 싱글레귤러', color: '#f472b6', emoji: '🍦', weight: 20, quantity: 4, remaining: 4 },
    { id: 'chicken', name: '치킨 기프티콘', color: '#f59e0b', emoji: '🍗', weight: 15, quantity: 2, remaining: 2 },
    { id: 'giftcard', name: '문화상품권 1만원', color: '#fbbf24', emoji: '💳', weight: 7, quantity: 2, remaining: 2 },
    { id: 'airpods', name: '에어팟 프로', color: '#38bdf8', emoji: '🎧', weight: 3, quantity: 1, remaining: 1 }
  ];

  const DEFAULT_UI_SETTINGS = {
    fontScale: 100,
    qrPosition: 'right',
    qrSize: 100,
    qrVisible: true
  };

  function loadLocalUiSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem('luckygrab:uiSettings') || '{}');
      return Object.assign({}, DEFAULT_UI_SETTINGS, raw || {});
    } catch (_) {
      return Object.assign({}, DEFAULT_UI_SETTINGS);
    }
  }

  const S = {
    connected: false,
    standalone: false,
    relayConnected: false,
    room: '',
    controllerCount: 0,
    phase: 'idle',
    activeLabel: null,
    queueLength: 0,
    prizes: [],
    config: null,
    lastPrize: null,
    qrExpanded: true,
    padVisible: true,
    uiSettings: loadLocalUiSettings()
  };

  /* --------------------------------------------------------------- canvas */
  let W = 0, H = 0, DPR = 1;
  let bgGrad = null;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    for (const c of [scene, fxCanvas]) {
      c.width = Math.round(W * DPR);
      c.height = Math.round(H * DPR);
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fxc.setTransform(DPR, 0, 0, DPR, 0, 0);

    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0a0718');
    bgGrad.addColorStop(0.42, '#0e0a24');
    bgGrad.addColorStop(0.75, '#160f2e');
    bgGrad.addColorStop(1, '#07050f');

    layout.target = computeTargetRect();
    if (layout.cur.w <= 1) layout.cur = Object.assign({}, layout.target);
    fitCamera();
  }

  /* --------------------------------------------------------------- camera */
  const FOV = (42 * Math.PI) / 180;
  const cam = {
    dist: 11,
    pitch: 0.44,
    eye: [0, 6, 9],
    target: [0, 2.1, 0],
    basis: { f: [0, 0, -1], r: [1, 0, 0], u: [0, 1, 0] },
    fpx: 800,
    cx: 0,
    cy: 0
  };

  const layout = {
    target: { x: 0, y: 0, w: 1, h: 1 },
    cur: { x: 0, y: 0, w: 1, h: 1 }
  };

  function computeTargetRect() {
    const portrait = W / H < 0.95;
    if (portrait) {
      return { x: W * 0.04, y: H * 0.125, w: W * 0.92, h: H * 0.635 };
    }
    const u = S.uiSettings || DEFAULT_UI_SETTINGS;
    const qrSide = S.qrExpanded && u.qrVisible !== false && u.qrPosition === 'right';
    return {
      x: W * (qrSide ? 0.028 : 0.09),
      y: H * 0.105,
      w: W * (qrSide ? 0.705 : 0.815),
      h: H * 0.775
    };
  }

  // 실제로 보이는 윤곽(앞면 기준)에 가깝게 잡아 화면을 꽉 채웁니다.
  const FIT_POINTS = [];
  for (const x of [-3.36, 3.36]) {
    FIT_POINTS.push([x, 5.54, 2.03]);   // 간판 위
    FIT_POINTS.push([x, 4.18, -2.05]);  // 유리 상자 위(뒤)
    FIT_POINTS.push([x, -1.02, 2.3]);   // 받침 아래(앞)
    FIT_POINTS.push([x, -1.02, -2.26]); // 받침 아래(뒤)
  }

  function setBasis(dist) {
    cam.pitch = W / H < 0.95 ? 0.40 : 0.455;
    const ty = 2.05;
    cam.eye = [0, ty + Math.sin(cam.pitch) * dist, Math.cos(cam.pitch) * dist];
    cam.target = [0, ty, 0];
    const f = norm(sub(cam.target, cam.eye));
    const r = norm(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    cam.basis = { f, r, u };
    cam.fpx = H / 2 / Math.tan(FOV / 2);
  }

  function project(p) {
    const dx = p[0] - cam.eye[0];
    const dy = p[1] - cam.eye[1];
    const dz = p[2] - cam.eye[2];
    const b = cam.basis;
    const zc = dx * b.f[0] + dy * b.f[1] + dz * b.f[2];
    if (zc < 0.25) return null;
    const xc = dx * b.r[0] + dy * b.r[1] + dz * b.r[2];
    const yc = dx * b.u[0] + dy * b.u[1] + dz * b.u[2];
    const s = cam.fpx / zc;
    return { x: cam.cx + xc * s, y: cam.cy - yc * s, s, z: zc };
  }

  function measure() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of FIT_POINTS) {
      const q = project(p);
      if (!q) continue;
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  function fitCamera() {
    const r = layout.cur;
    let dist = cam.dist;
    for (let i = 0; i < 5; i++) {
      setBasis(dist);
      cam.cx = 0; cam.cy = 0;
      const b = measure();
      const s = Math.min(r.w / Math.max(1, b.w), r.h / Math.max(1, b.h));
      dist = dist / clamp(s, 0.05, 4);
    }
    setBasis(dist);
    cam.cx = 0; cam.cy = 0;
    const b = measure();
    cam.cx = r.x + r.w / 2 - b.cx;
    cam.cy = r.y + r.h / 2 - b.cy;
    cam.dist = dist;
  }

  /* -------------------------------------------------------------- vectors */
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  /* -------------------------------------------------------------- geometry */
  const BOX = { hx: 3.0, hz: 1.98, top: 4.15 };
  const BASE = { x: 3.24, y0: -0.98, z: 2.22 };
  const CHUTE = { x0: 1.72, x1: 2.72, z0: 0.70, z1: 1.78 };
  const CHUTE_C = [(CHUTE.x0 + CHUTE.x1) / 2, 0.02, (CHUTE.z0 + CHUTE.z1) / 2];

  /* --------------------------------------------------------------- sprites */
  const spriteCache = new Map();
  function capsuleSprite(prize) {
    const key = prize.id + '|' + prize.color + '|' + (prize.emoji || '');
    if (spriteCache.has(key)) return spriteCache.get(key);
    const SZ = 220;
    const c = document.createElement('canvas');
    c.width = c.height = SZ;
    const g = c.getContext('2d');
    const cx = SZ / 2, cy = SZ / 2, R = SZ / 2 - 9;
    const col = prize.color || '#9aa7ff';

    // 1) 전체 구 형태 클리핑
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.clip();

    // 2) 아래쪽 반구 (불투명 유광 컬러 플라스틱 + 입체 음영)
    const botGrad = g.createRadialGradient(cx - R * 0.28, cy + R * 0.18, R * 0.05, cx, cy + R * 0.1, R * 1.05);
    botGrad.addColorStop(0, mixHex(col, '#ffffff', 0.45));
    botGrad.addColorStop(0.45, col);
    botGrad.addColorStop(0.82, mixHex(col, '#05020e', 0.48));
    botGrad.addColorStop(1, mixHex(col, '#020108', 0.72));
    g.fillStyle = botGrad;
    g.fillRect(0, cy - R * 0.12, SZ, R * 1.25);

    // 3) 위쪽 반구 (투명 아크릴 돔 내부 배경 — 은은한 컬러 틴트)
    const topGrad = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.04, cx, cy, R * 1.02);
    topGrad.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
    topGrad.addColorStop(0.45, rgba(col, 0.26));
    topGrad.addColorStop(0.85, rgba(mixHex(col, '#08041a', 0.45), 0.55));
    topGrad.addColorStop(1, rgba(mixHex(col, '#050210', 0.75), 0.85));
    g.fillStyle = topGrad;
    g.fillRect(0, 0, SZ, cy + R * 0.18);

    // 4) 투명 돔 안에 들어있는 경품 피규어/이모지 + 황금빛 홀로그램 받침
    g.save();
    const innerPadGrad = g.createRadialGradient(cx, cy + R * 0.04, 2, cx, cy + R * 0.04, R * 0.72);
    innerPadGrad.addColorStop(0, mixHex(col, '#ffffff', 0.65));
    innerPadGrad.addColorStop(0.7, col);
    innerPadGrad.addColorStop(1, mixHex(col, '#0a051c', 0.55));
    g.fillStyle = innerPadGrad;
    g.beginPath();
    g.ellipse(cx, cy + R * 0.04, R * 0.88, R * 0.24, 0, 0, TAU);
    g.fill();

    // 캡슐 내부 경품 아이콘
    const em = prize.emoji || '🎁';
    g.font = `${Math.round(R * 0.74)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0, 0, 0, 0.45)';
    g.shadowBlur = R * 0.14;
    g.shadowOffsetY = R * 0.05;
    g.fillText(em, cx, cy - R * 0.18);
    g.restore();

    // 5) 위·아래 결합 플라스틱 메탈릭 링 (이음선)
    g.beginPath();
    g.ellipse(cx, cy + R * 0.04, R * 0.99, R * 0.25, 0, 0, Math.PI);
    g.lineWidth = R * 0.095;
    g.strokeStyle = mixHex(col, '#ffffff', 0.38);
    g.stroke();

    g.beginPath();
    g.ellipse(cx, cy + R * 0.055, R * 0.99, R * 0.25, 0, 0, Math.PI);
    g.lineWidth = R * 0.045;
    g.strokeStyle = 'rgba(0, 0, 0, 0.38)';
    g.stroke();

    g.beginPath();
    g.ellipse(cx, cy + R * 0.025, R * 0.99, R * 0.25, 0, 0, Math.PI);
    g.lineWidth = R * 0.032;
    g.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    g.stroke();

    // 6) 구 전체의 아크릴 굴절 & 앰비언트 오클루전(가장자리 깊이감)
    const rimShade = g.createRadialGradient(cx, cy, R * 0.68, cx, cy, R);
    rimShade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    rimShade.addColorStop(0.76, 'rgba(0, 0, 0, 0.12)');
    rimShade.addColorStop(1, 'rgba(4, 2, 14, 0.58)');
    g.fillStyle = rimShade;
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.fill();

    // 7) 스튜디오 소프트박스 반사 하이라이트 (왼쪽 위 곡면 광택)
    g.save();
    g.translate(cx - R * 0.34, cy - R * 0.38);
    g.rotate(-0.58);
    const spec1 = g.createRadialGradient(0, 0, 1, 0, 0, R * 0.44);
    spec1.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
    spec1.addColorStop(0.45, 'rgba(255, 255, 255, 0.42)');
    spec1.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = spec1;
    g.beginPath();
    g.ellipse(0, 0, R * 0.42, R * 0.22, 0, 0, TAU);
    g.fill();

    // 선명한 창문 반사 포인트
    g.fillStyle = 'rgba(255, 255, 255, 0.92)';
    g.beginPath();
    g.ellipse(-R * 0.06, -R * 0.04, R * 0.16, R * 0.075, 0.1, 0, TAU);
    g.fill();
    g.restore();

    // 오른쪽 아래 반사광 (바닥 네온 반사)
    const bounce = g.createRadialGradient(cx + R * 0.38, cy + R * 0.48, 2, cx + R * 0.38, cy + R * 0.48, R * 0.55);
    bounce.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
    bounce.addColorStop(0.5, rgba(mixHex(col, '#70f5ff', 0.5), 0.22));
    bounce.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = bounce;
    g.beginPath();
    g.arc(cx + R * 0.38, cy + R * 0.48, R * 0.55, 0, TAU);
    g.fill();

    g.restore();

    // 8) 외곽 프레넬(Fresnel) 유리 테두리 빛
    g.beginPath();
    g.arc(cx, cy, R - 1, Math.PI * 0.85, Math.PI * 1.78);
    g.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    g.lineWidth = R * 0.042;
    g.lineCap = 'round';
    g.stroke();

    spriteCache.set(key, c);
    return c;
  }

  /* ------------------------------------------------------------------ pile */
  const PILE = { spanX: 4.7, spanZ: 3.0, r: 0.285 };
  let capsules = [];

  function pilePrize() {
    const pool = S.prizes.length ? S.prizes : [{ id: 'x', color: '#8b5cf6', name: '?' }];
    const weights = pool.map((p) => Math.max(0.05, p.remaining ?? 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function buildPile() {
    capsules = [];
    const cols = 9, rows = 6;
    for (let layer = 0; layer < 3; layer++) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = -PILE.spanX / 2 + (c / (cols - 1)) * PILE.spanX + rand(-0.07, 0.07);
          const z = -PILE.spanZ / 2 + (r / (rows - 1)) * PILE.spanZ + rand(-0.07, 0.07);
          const e = Math.pow(x / (PILE.spanX / 2 + 0.35), 2) * 0.9 + Math.pow(z / (PILE.spanZ / 2 + 0.35), 2) * 1.0;
          if (e > 1.02) continue;
          // 배출구 자리는 비워 둡니다
          if (x > CHUTE.x0 - 0.28 && z > CHUTE.z0 - 0.28) continue;
          // 위로 갈수록 가운데로 모이는 둑 모양
          const skip = layer === 0 ? 0 : layer === 1 ? 0.05 + e * 0.42 : 0.32 + e * 0.55;
          if (Math.random() < skip) continue;
          const y = PILE.r + layer * PILE.r * 1.58 + (1 - e) * 0.04 * layer + rand(-0.03, 0.03);
          capsules.push({
            x, y, z,
            ox: 0, oy: 0, oz: 0,
            vx: 0, vy: 0, vz: 0,
            r: PILE.r * rand(0.93, 1.05),
            prize: pilePrize(),
            phase: Math.random() * TAU
          });
        }
      }
    }
  }

  function updatePile(dt) {
    for (const c of capsules) {
      if (c.vx || c.vy || c.vz || c.ox || c.oy || c.oz) {
        const k = 120, d = 11;
        c.vx += (-c.ox * k - c.vx * d) * dt;
        c.vy += (-c.oy * k - c.vy * d) * dt;
        c.vz += (-c.oz * k - c.vz * d) * dt;
        c.ox += c.vx * dt;
        c.oy += c.vy * dt;
        c.oz += c.vz * dt;
        if (Math.abs(c.ox) < 0.0005 && Math.abs(c.vx) < 0.0005) { c.ox = 0; c.vx = 0; }
        if (Math.abs(c.oy) < 0.0005 && Math.abs(c.vy) < 0.0005) { c.oy = 0; c.vy = 0; }
        if (Math.abs(c.oz) < 0.0005 && Math.abs(c.vz) < 0.0005) { c.oz = 0; c.vz = 0; }
      }
    }
  }

  function nudgePile(cx, cz, strength) {
    for (const c of capsules) {
      const dx = c.x - cx, dz = c.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.95) continue;
      const f = (1 - dist / 0.95) * strength;
      c.vx += (Math.random() - 0.5) * f;
      c.vz += (Math.random() - 0.5) * f;
      c.vy += Math.random() * f * 0.6;
    }
  }

  /* ----------------------------------------------------------------- crane */
  const crane = {
    x: 0, z: 0, hubY: 2.72,
    vx: 0, vz: 0,
    open: 0.55,        // 0 = 다 붙음, 1 = 활짝
    sway: 0
  };
  const input = { x: 0, z: 0 };   // 서버에서 온 컨트롤러 입력
  const kb = { x: 0, z: 0 };      // 키보드 입력
  const tp = { x: 0, z: 0 };      // 화면 터치패드 입력

  let anim = null;                // 뽑기 애니메이션 상태
  let falling = null;             // 떨어지는 캡슐

  const TIMELINE = {
    openEnd: 0.32,
    descendEnd: 1.22,
    closeEnd: 1.66,
    liftEnd: 2.44,
    travelEnd: 3.28,
    releaseEnd: 3.72,
    homeEnd: 4.45
  };

  function startGrabAnim(prize, playerLabel) {
    if (anim) return;
    // 집게 아래에서 해당 경품 캡슐 찾기 (없으면 가장 가까운 캡슐)
    let target = null, best = Infinity;
    for (const c of capsules) {
      if (c.prize && c.prize.id === prize.id) {
        const d = Math.hypot(c.x - crane.x, c.z - crane.z);
        if (d < best) { best = d; target = c; }
      }
    }
    if (!target) {
      for (const c of capsules) {
        const d = Math.hypot(c.x - crane.x, c.z - crane.z);
        if (d < best) { best = d; target = c; }
      }
    }
    anim = {
      t: 0,
      prize,
      playerLabel,
      target,
      cx: target ? target.x : crane.x,
      cz: target ? target.z : crane.z,
      grabY: target ? target.y + 0.52 : 0.82,
      startX: crane.x,
      startZ: crane.z,
      startHub: crane.hubY,
      held: false,
      droppedSent: false,
      grabbedCapsule: null,
      capsulePos: null,
      sparkled: false
    };
  }

  function removeCapsule(c) {
    const i = capsules.indexOf(c);
    if (i >= 0) capsules.splice(i, 1);
    nudgePile(c.x, c.z, 1.4);
  }

  function updateCrane(dt) {
    if (anim) { updateAnim(dt); return; }

    const ix = clamp(input.x + kb.x + tp.x, -1, 1);
    const iz = clamp(input.z + kb.z + tp.z, -1, 1);
    const speed = 2.55;

    const tvx = ix * speed;
    const tvz = iz * speed;
    const accel = Math.min(1, dt * 9);
    crane.vx += (tvx - crane.vx) * accel;
    crane.vz += (tvz - crane.vz) * accel;

    const prevX = crane.x;
    crane.x = clamp(crane.x + crane.vx * dt, -2.34, 2.34);
    crane.z = clamp(crane.z + crane.vz * dt, -1.34, 1.34);
    crane.sway = lerp(crane.sway, (crane.x - prevX) * 6, Math.min(1, dt * 8));
    crane.hubY = lerp(crane.hubY, 2.72 + Math.sin(nowSec() * 1.4) * 0.02, Math.min(1, dt * 4));
    crane.open = lerp(crane.open, 0.55, Math.min(1, dt * 6));
  }

  function updateAnim(dt) {
    const a = anim;
    const T = TIMELINE;

    if (a.t === 0 && a.target) nudgePile(a.cx, a.cz, 0.12);
    a.t += dt;
    const t = a.t;

    if (t < T.openEnd) {
      crane.open = lerp(0.55, 1.12, easeOut(t / T.openEnd));
      crane.x = lerp(a.startX, a.cx, easeInOut(t / T.openEnd) * 0.55);
      crane.z = lerp(a.startZ, a.cz, easeInOut(t / T.openEnd) * 0.55);
      crane.hubY = lerp(a.startHub, 2.95, easeOut(t / T.openEnd));
    } else if (t < T.descendEnd) {
      const k = (t - T.openEnd) / (T.descendEnd - T.openEnd);
      crane.open = 1.12;
      crane.x = lerp(lerp(a.startX, a.cx, 0.55), a.cx, easeInOut(k));
      crane.z = lerp(lerp(a.startZ, a.cz, 0.55), a.cz, easeInOut(k));
      crane.hubY = lerp(2.95, a.grabY, easeInOut(k));
      if (Math.random() < 0.35) nudgePile(a.cx, a.cz, 0.06);
    } else if (t < T.closeEnd) {
      const k = (t - T.closeEnd === 0) ? 1 : (t - T.descendEnd) / (T.closeEnd - T.descendEnd);
      crane.hubY = a.grabY;
      crane.open = lerp(1.12, 0.20, easeInOut(k));
      if (k > 0.86 && !a.held) {
        a.held = true;
        if (a.target) {
          a.grabbedCapsule = a.target;
          removeCapsule(a.target);
        }
        nudgePile(a.cx, a.cz, 1.1);
      }
    } else if (t < T.liftEnd) {
      const k = (t - T.closeEnd) / (T.liftEnd - T.closeEnd);
      crane.open = 0.20;
      crane.hubY = lerp(a.grabY, 3.50, easeInOut(k));
    } else if (t < T.travelEnd) {
      const k = (t - T.liftEnd) / (T.travelEnd - T.liftEnd);
      const e = easeInOut(k);
      crane.x = lerp(a.cx, CHUTE_C[0], e);
      crane.z = lerp(a.cz, CHUTE_C[2] - 0.05, e);
      crane.hubY = 3.50;
      crane.open = 0.20;
    } else if (t < T.releaseEnd) {
      const k = (t - T.travelEnd) / (T.releaseEnd - T.travelEnd);
      crane.hubY = lerp(3.50, 3.10, easeInOut(Math.min(1, k * 1.6)));
      crane.open = k > 0.55 ? lerp(0.20, 1.05, (k - 0.55) / 0.45) : 0.20;
      if (a.held && !a.dropped && k > 0.55) {
        a.dropped = true;
        const cp = heldPosition();
        falling = {
          x: cp[0], y: cp[1], z: cp[2],
          vy: 0, prize: a.prize, life: 1
        };
        a.capsulePos = null;
        a.held = false;
        Sound.thud();
      }
    } else if (t < T.homeEnd) {
      const k = (t - T.releaseEnd) / (T.homeEnd - T.releaseEnd);
      const e = easeInOut(k);
      crane.open = lerp(1.05, 0.55, e);
      crane.hubY = lerp(3.10, 2.72, e);
      crane.x = lerp(CHUTE_C[0], 0.9, e);
      crane.z = lerp(CHUTE_C[2] - 0.05, 0.25, e);
    } else {
      // 마무리
      if (!a.droppedSent) {
        a.droppedSent = true;
        if (S.connected) net.send({ type: 'grab_done' });
        else finishStandaloneGrab(a.prize, a.playerLabel);
        celebrate(a.prize, a.playerLabel);
      }
      anim = null;
      crane.open = 0.55;
      return;
    }

    if (a.held) {
      const cp = heldPosition();
      a.capsulePos = cp;
    }
    if (falling) updateFalling(dt);
    if (!a.droppedSent && a.dropped && t > T.releaseEnd - 0.02) {
      a.droppedSent = true;
      if (S.connected) net.send({ type: 'grab_done' });
      else finishStandaloneGrab(a.prize, a.playerLabel);
      celebrate(a.prize, a.playerLabel);
    }
  }

  function heldPosition() {
    const cy = crane.hubY - 0.60;
    return [crane.x, Math.max(0.42, cy), crane.z];
  }

  function updateFalling(dt) {
    if (!falling) return;
    falling.vy -= 8.5 * dt;
    falling.y += falling.vy * dt;
    if (falling.y < -0.55) {
      falling.life -= dt * 3;
      if (falling.life <= 0) falling = null;
    }
  }

  /* -------------------------------------------------------------- confetti */
  const particles = [];
  let ripples = [];

  function burstConfetti(origin, color) {
    const palette = [color, '#ffffff', '#ffd76a', '#45e9ff', '#ff4fa8', '#a78bfa'];
    for (let i = 0; i < 220; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const sp = rand(220, 900);
      particles.push({
        x: origin.x + rand(-50, 50),
        y: origin.y + rand(-30, 30),
        vx: Math.cos(a) * sp * rand(0.35, 1),
        vy: Math.sin(a) * sp * rand(0.5, 1),
        w: rand(5, 13),
        h: rand(9, 24),
        rot: rand(0, TAU),
        vr: rand(-9, 9),
        color: palette[(Math.random() * palette.length) | 0],
        life: rand(3.6, 6.2),
        age: 0,
        round: Math.random() < 0.25
      });
    }
    ripples.push({ x: origin.x, y: origin.y, r: 10, life: 1, color });
    Sound.win();
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      p.vy += 620 * dt;
      p.vx *= 1 - 0.7 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.age > p.life || p.y > H + 80) particles.splice(i, 1);
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.life -= dt * 1.5;
      r.r += 900 * dt;
      if (r.life <= 0) ripples.splice(i, 1);
    }
  }

  function drawParticles() {
    fxc.clearRect(0, 0, W, H);
    for (const r of ripples) {
      fxc.beginPath();
      fxc.arc(r.x, r.y, r.r, 0, TAU);
      fxc.strokeStyle = rgba(r.color, Math.max(0, r.life) * 0.5);
      fxc.lineWidth = 6 * Math.max(0.2, r.life);
      fxc.stroke();
    }
    for (const p of particles) {
      const alpha = clamp(1 - (p.age - p.life + 0.9) / 0.9, 0, 1);
      fxc.save();
      fxc.globalAlpha = alpha;
      fxc.translate(p.x, p.y);
      fxc.rotate(p.rot);
      fxc.fillStyle = p.color;
      if (p.round) {
        fxc.beginPath();
        fxc.arc(0, 0, p.w * 0.6, 0, TAU);
        fxc.fill();
      } else {
        fxc.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.5 + Math.abs(Math.cos(p.rot)) * 0.5));
      }
      fxc.restore();
    }
  }

  /* ----------------------------------------------------------------- draw */
  const clock = { t: 0 };

  function poly3(points, fill, stroke, lw) {
    const ps = [];
    for (const p of points) {
      const q = project(p);
      if (!q) return;
      ps.push(q);
    }
    ctx.beginPath();
    ps.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }

  function line3(a, b, color, lw, glowColor, glowSize) {
    const pa = project(a), pb = project(b);
    if (!pa || !pb) return;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.6, lw);
    ctx.lineCap = 'round';
    if (glowColor) { ctx.shadowColor = glowColor; ctx.shadowBlur = glowSize || 12; }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawBackdrop() {
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // 아케이드 홀 배경 보케(Bokeh) 네온 조명들
    const bokehList = [
      { x: 0.14, y: 0.24, r: 0.16, c: 'rgba(255, 70, 180, 0.14)' },
      { x: 0.86, y: 0.22, r: 0.18, c: 'rgba(60, 220, 255, 0.13)' },
      { x: 0.22, y: 0.58, r: 0.14, c: 'rgba(140, 90, 255, 0.14)' },
      { x: 0.78, y: 0.62, r: 0.15, c: 'rgba(255, 180, 70, 0.11)' },
      { x: 0.50, y: 0.26, r: 0.36, c: 'rgba(130, 90, 255, 0.22)' }
    ];
    const maxDim = Math.max(W, H);
    for (let i = 0; i < bokehList.length; i++) {
      const b = bokehList[i];
      const bx = W * b.x + Math.sin(clock.t * 0.4 + i) * 18;
      const by = H * b.y + Math.cos(clock.t * 0.35 + i) * 12;
      const br = maxDim * b.r;
      const bg = ctx.createRadialGradient(bx, by, 4, bx, by, br);
      bg.addColorStop(0, b.c);
      bg.addColorStop(0.55, b.c.replace(/[\d.]+\)$/, '0.04)'));
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    }

    // 유광 아케이드 타일 바닥 & 원근 그리드 반사
    const fy = H * 0.82;
    const floorG = ctx.createLinearGradient(0, fy, 0, H);
    floorG.addColorStop(0, 'rgba(20, 12, 44, 0.0)');
    floorG.addColorStop(0.25, 'rgba(24, 15, 52, 0.72)');
    floorG.addColorStop(1, 'rgba(6, 4, 15, 0.96)');
    ctx.fillStyle = floorG;
    ctx.fillRect(0, fy, W, H - fy);

    const fg = ctx.createRadialGradient(W * 0.5, H * 0.88, 10, W * 0.5, H * 0.88, W * 0.48);
    fg.addColorStop(0, 'rgba(255, 79, 168, 0.24)');
    fg.addColorStop(0.42, 'rgba(69, 233, 255, 0.12)');
    fg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, fy - H * 0.15, W, H * 0.45);

    // 별 & 반짝이는 입자
    ctx.save();
    for (let i = 0; i < 46; i++) {
      const seed = i * 97.13;
      const x = ((Math.sin(seed) * 0.5 + 0.5) * W);
      const y = ((Math.cos(seed * 1.7) * 0.5 + 0.5) * H * 0.8);
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clock.t * 1.6 + i));
      ctx.globalAlpha = 0.10 + tw * 0.22;
      ctx.fillStyle = i % 5 === 0 ? '#ff9bd4' : '#bcd6ff';
      ctx.beginPath();
      ctx.arc(x, y, (i % 7 === 0 ? 1.8 : 1.0), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawInterior() {
    const { hx, hz, top } = BOX;

    // 1) 뒷면 고급 아케이드 쇼케이스 백월 (네온 아치 + 별빛 미러 패널)
    const pTL = project([-hx, top, -hz]);
    const pBL = project([-hx, 0.02, -hz]);
    const bp = ctx.createLinearGradient(0, pTL ? pTL.y : 0, 0, pBL ? pBL.y : H);
    bp.addColorStop(0, '#271a5e');
    bp.addColorStop(0.45, '#191142');
    bp.addColorStop(0.85, '#100a2b');
    bp.addColorStop(1, '#09061a');
    poly3([[-hx, 0.02, -hz], [hx, 0.02, -hz], [hx, top, -hz], [-hx, top, -hz]], bp);

    // 뒷벽 다이아몬드 퀼팅/그리드 패턴 & 네온 몰딩
    for (let i = 1; i <= 5; i++) {
      const x = -hx + (i / 6) * (hx * 2);
      line3([x, 0.08, -hz + 0.01], [x, top - 0.08, -hz + 0.01], 'rgba(160, 140, 255, 0.07)', 1.1);
    }
    for (let i = 1; i <= 3; i++) {
      const y = 0.2 + i * 1.02;
      line3([-hx + 0.12, y, -hz + 0.02], [hx - 0.12, y, -hz + 0.02], 'rgba(170, 140, 255, 0.12)', 1.3);
    }

    // 뒷벽 중앙 네온 서클 엠블럼
    const backCenter = project([0, 2.25, -hz + 0.03]);
    if (backCenter) {
      ctx.save();
      const r1 = 1.35 * backCenter.s;
      const r2 = 1.05 * backCenter.s;
      const bgGlow = ctx.createRadialGradient(backCenter.x, backCenter.y, r2 * 0.2, backCenter.x, backCenter.y, r1 * 1.25);
      bgGlow.addColorStop(0, 'rgba(255, 90, 190, 0.18)');
      bgGlow.addColorStop(0.5, 'rgba(70, 220, 255, 0.10)');
      bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bgGlow;
      ctx.beginPath();
      ctx.arc(backCenter.x, backCenter.y, r1 * 1.25, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 110, 200, 0.24)';
      ctx.lineWidth = Math.max(1.4, backCenter.s * 0.022);
      ctx.beginPath();
      ctx.arc(backCenter.x, backCenter.y, r1, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(80, 230, 255, 0.22)';
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = Math.max(1.2, backCenter.s * 0.016);
      ctx.beginPath();
      ctx.arc(backCenter.x, backCenter.y, r2, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // 2) 네 모서리 내부 수직 LED 네온 튜브 (실제 인형뽑기 기계의 화려한 코너 조명)
    const ledCorners = [
      [-hx + 0.07, -hz + 0.07, '#45e9ff', 'rgba(69,233,255,0.75)'],
      [ hx - 0.07, -hz + 0.07, '#45e9ff', 'rgba(69,233,255,0.75)'],
      [-hx + 0.07,  hz - 0.07, '#ff5fb2', 'rgba(255,79,168,0.75)'],
      [ hx - 0.07,  hz - 0.07, '#ff5fb2', 'rgba(255,79,168,0.75)']
    ];
    for (const [lx, lz, lcol, lglow] of ledCorners) {
      line3([lx, 0.06, lz], [lx, top - 0.08, lz], lcol, 3.2, lglow, 18);
      line3([lx, 0.06, lz], [lx, top - 0.08, lz], '#ffffff', 1.1);
    }

    // 천장 LED 라이트 바
    for (const [yy, col, glow] of [
      [3.92, 'rgba(255, 175, 235, 0.85)', 'rgba(255, 79, 168, 0.7)'],
      [3.76, 'rgba(155, 240, 255, 0.75)', 'rgba(69, 233, 255, 0.65)']
    ]) {
      line3([-hx + 0.16, yy, hz - 0.12], [hx - 0.16, yy, hz - 0.12], col, 3.0, glow, 24);
      line3([-hx + 0.16, yy, -hz + 0.12], [hx - 0.16, yy, -hz + 0.12], col, 2.2, glow, 16);
    }

    // 3) 천장에서 내려오는 볼류메트릭 스포트라이트 빔
    const spTop = project([0, top, 0]);
    const spBot = project([0, 0, 0]);
    if (spTop && spBot) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const beamG = ctx.createLinearGradient(0, spTop.y, 0, spBot.y);
      beamG.addColorStop(0, 'rgba(210, 190, 255, 0.11)');
      beamG.addColorStop(0.6, 'rgba(170, 140, 255, 0.04)');
      beamG.addColorStop(1, 'rgba(170, 140, 255, 0)');
      ctx.fillStyle = beamG;
      ctx.beginPath();
      ctx.moveTo(spTop.x - 1.9 * spTop.s, spTop.y);
      ctx.lineTo(spTop.x + 1.9 * spTop.s, spTop.y);
      ctx.lineTo(spBot.x + 3.1 * spBot.s, spBot.y);
      ctx.lineTo(spBot.x - 3.1 * spBot.s, spBot.y);
      ctx.closePath();
      ctx.fill();

      const g2 = ctx.createRadialGradient(spBot.x, spBot.y - 0.7 * spBot.s, 4, spBot.x, spBot.y, 3.5 * spBot.s);
      g2.addColorStop(0, 'rgba(210, 185, 255, 0.16)');
      g2.addColorStop(1, 'rgba(180, 160, 255, 0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.ellipse(spBot.x, spBot.y, 3.3 * spBot.s, 1.55 * spBot.s, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // 옆면 유리
    poly3([[-hx, 0, -hz], [-hx, 0, hz], [-hx, top, hz], [-hx, top, -hz]], 'rgba(130, 180, 255, 0.06)');
    poly3([[hx, 0, -hz], [hx, 0, hz], [hx, top, hz], [hx, top, -hz]], 'rgba(255, 130, 225, 0.055)');

    // 4) 내부 바닥 (체커보드/스테이지 플로어 + 메탈릭 몰딩)
    const fc = project([0, 0, 0]);
    if (fc) {
      const g = ctx.createRadialGradient(fc.x, fc.y, 4, fc.x, fc.y, 4.3 * fc.s);
      g.addColorStop(0, '#2e2166');
      g.addColorStop(0.55, '#1a1242');
      g.addColorStop(1, '#0d0926');
      poly3([[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]], g, 'rgba(150, 220, 255, 0.25)', 1.5);
    }

    // 5) 입체 아크릴 경품 배출구 (Chute Box — 투명 격벽과 네온 가드레일)
    const chH = 0.62;
    const chWall1 = [[CHUTE.x0, 0, CHUTE.z0], [CHUTE.x1, 0, CHUTE.z0], [CHUTE.x1, chH, CHUTE.z0], [CHUTE.x0, chH, CHUTE.z0]];
    const chWall2 = [[CHUTE.x0, 0, CHUTE.z0], [CHUTE.x0, 0, CHUTE.z1], [CHUTE.x0, chH, CHUTE.z1], [CHUTE.x0, chH, CHUTE.z0]];
    poly3(chWall1, 'rgba(90, 220, 255, 0.10)', 'rgba(110, 235, 255, 0.55)', 1.6);
    poly3(chWall2, 'rgba(90, 220, 255, 0.14)', 'rgba(110, 235, 255, 0.65)', 1.6);

    const hole = [[CHUTE.x0, 0.008, CHUTE.z0], [CHUTE.x1, 0.008, CHUTE.z0], [CHUTE.x1, 0.008, CHUTE.z1], [CHUTE.x0, 0.008, CHUTE.z1]];
    poly3(hole, 'rgba(3, 2, 10, 0.96)', 'rgba(69, 233, 255, 0.85)', 2.4);
    line3([CHUTE.x0, chH, CHUTE.z0], [CHUTE.x1, chH, CHUTE.z0], '#70f3ff', 2.6, 'rgba(69,233,255,0.8)', 14);
    line3([CHUTE.x0, chH, CHUTE.z0], [CHUTE.x0, chH, CHUTE.z1], '#70f3ff', 2.6, 'rgba(69,233,255,0.8)', 14);

    const hc = project([CHUTE_C[0], 0.02, CHUTE_C[2]]);
    if (hc) {
      ctx.save();
      ctx.shadowColor = 'rgba(69,233,255,0.75)';
      ctx.shadowBlur = 26;
      ctx.beginPath();
      ctx.ellipse(hc.x, hc.y, 0.44 * hc.s, 0.18 * hc.s, 0, 0, TAU);
      ctx.fillStyle = 'rgba(69,233,255,0.12)';
      ctx.fill();
      ctx.restore();
    }
  }

  function drawFloorShadow() {
    const c = project([0, 0.0, 0]);
    if (!c) return;
    ctx.save();
    ctx.translate(c.x, c.y + 12 * (c.s / 100));
    ctx.scale(1, 0.32);
    const r = 3.7 * c.s;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(0,0,0,0.65)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.32)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawCapsules() {
    const list = [];
    for (const c of capsules) {
      const p = project([c.x + c.ox, c.y + c.oy, c.z + c.oz]);
      if (!p) continue;
      list.push({ c, p });
    }
    list.sort((a, b) => b.p.z - a.p.z);

    for (const { c, p } of list) {
      const R = c.r * p.s;
      if (R < 0.7) continue;
      const spr = capsuleSprite(c.prize);
      // 접지 그림자
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.translate(p.x, p.y + R * 0.72);
      ctx.scale(1, 0.42);
      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.15);
      sg.addColorStop(0, 'rgba(0,0,0,0.85)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.15, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.drawImage(spr, p.x - R, p.y - R, R * 2, R * 2);
    }
  }

  function drawHeldCapsule(pos, prize, scale) {
    const p = project(pos);
    if (!p) return;
    const R = 0.285 * p.s * (scale || 1);
    const spr = capsuleSprite(prize);
    ctx.drawImage(spr, p.x - R, p.y - R, R * 2, R * 2);
  }

  function drawAimRing() {
    const p = project([crane.x, 0.36, crane.z]);
    if (!p) return;
    const rx = 0.34 * p.s;
    const ry = 0.34 * p.s * Math.sin(cam.pitch) * 0.95;
    const active = anim !== null;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -clock.t * 22;
    ctx.strokeStyle = active ? 'rgba(255,215,106,0.85)' : 'rgba(69,233,255,0.55)';
    ctx.lineWidth = Math.max(1.2, p.s * 0.012);
    ctx.shadowColor = active ? 'rgba(255,215,106,0.9)' : 'rgba(69,233,255,0.8)';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // 조준점
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, p.s * 0.018), 0, TAU);
    ctx.fillStyle = active ? 'rgba(255,215,106,0.9)' : 'rgba(69,233,255,0.8)';
    ctx.fill();
  }

  function drawCrane() {
    const railX = BOX.hx - 0.16;
    const railY = 3.96;
    const zNear = BOX.hz - 0.12;

    // 상단 레일
    line3([-railX, railY, -zNear], [-railX, railY, zNear], 'rgba(180,190,225,0.55)', 3);
    line3([railX, railY, -zNear], [railX, railY, zNear], 'rgba(180,190,225,0.55)', 3);

    // 브리지
    const bz = crane.z;
    line3([-railX, railY, bz], [railX, railY, bz], 'rgba(205,215,245,0.85)', 5, 'rgba(150,200,255,0.35)', 10);
    line3([-railX, railY + 0.06, bz], [railX, railY + 0.06, bz], 'rgba(255,255,255,0.35)', 1.4);

    // 트롤리
    const tp = project([crane.x, railY, bz]);
    if (tp) {
      const w = 0.30 * tp.s, h = 0.16 * tp.s;
      const g = ctx.createLinearGradient(tp.x - w, tp.y - h, tp.x + w, tp.y + h);
      g.addColorStop(0, '#e8ecff');
      g.addColorStop(0.5, '#8f9ac4');
      g.addColorStop(1, '#4a5273');
      ctx.fillStyle = g;
      roundRect(tp.x - w, tp.y - h * 0.8, w * 2, h * 1.6, h * 0.5);
      ctx.fill();
    }

    // 케이블 (코일 스프링 + 강철 와이어 질감)
    const swayX = crane.sway * 0.12;
    const cableTop = [crane.x, railY - 0.02, bz];
    const cableBot = [crane.x + swayX, crane.hubY + 0.15, crane.z];
    line3(cableTop, cableBot, 'rgba(90, 105, 145, 0.85)', Math.max(2.2, project(cableTop) ? project(cableTop).s * 0.022 : 3.2));
    line3(cableTop, cableBot, 'rgba(240, 248, 255, 0.9)', Math.max(1.0, project(cableTop) ? project(cableTop).s * 0.009 : 1.4));

    // 집게 본체 (실사 크롬 실린더 + 네온 파워 링 + 하단 황동 피벗 캡)
    const hp = project([crane.x + swayX * 0.4, crane.hubY, crane.z]);
    if (hp) {
      const r = 0.23 * hp.s;
      const g = ctx.createLinearGradient(hp.x - r, hp.y, hp.x + r, hp.y);
      g.addColorStop(0, '#4a5578');
      g.addColorStop(0.22, '#f8fbff');
      g.addColorStop(0.45, '#99a7cf');
      g.addColorStop(0.7, '#2d344d');
      g.addColorStop(0.88, '#cfd8f7');
      g.addColorStop(1, '#3b4361');

      // 상단 캡
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y - r * 0.34, r * 0.72, r * 0.32, 0, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();

      // 메인 크롬 하우징 몸통
      ctx.beginPath();
      ctx.moveTo(hp.x - r * 0.88, hp.y - r * 0.25);
      ctx.lineTo(hp.x - r * 0.68, hp.y + r * 0.56);
      ctx.lineTo(hp.x + r * 0.68, hp.y + r * 0.56);
      ctx.lineTo(hp.x + r * 0.88, hp.y - r * 0.25);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.stroke();

      // 상단 돔 덮개
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y - r * 0.25, r * 0.88, r * 0.42, 0, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();

      // 집게 중앙 LED 파워 코어 링 (작동 중엔 골드/핑크, 평상시 시안)
      const ledCol = anim ? '#ffd76a' : '#45e9ff';
      ctx.save();
      ctx.shadowColor = ledCol;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = ledCol;
      ctx.lineWidth = Math.max(1.8, r * 0.11);
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y + r * 0.12, r * 0.77, r * 0.24, 0, 0, Math.PI);
      ctx.stroke();
      ctx.restore();
    }

    // 집게 발 3개 (입체 메탈 관절 + 리벳 볼트 + 고무 그립 패드)
    const open = crane.open;
    const angles = [Math.PI * 0.5, Math.PI * 1.1666, Math.PI * 1.8333];
    const prongs = angles.map((ang) => {
      const spread = 0.12 + 0.46 * open;
      const bx = crane.x + Math.cos(ang) * 0.10;
      const bz2 = crane.z + Math.sin(ang) * 0.10;
      const by = crane.hubY - 0.02;
      const mx = crane.x + Math.cos(ang) * spread * 0.84;
      const mz = crane.z + Math.sin(ang) * spread * 0.84;
      const my = crane.hubY - 0.33;
      const tx = crane.x + Math.cos(ang) * spread * 0.58;
      const tz = crane.z + Math.sin(ang) * spread * 0.58;
      const ty = crane.hubY - 0.74;
      return { ang, b: [bx, by, bz2], m: [mx, my, mz], t: [tx, ty, tz] };
    });
    prongs.sort((a, b) => {
      const za = project(a.b), zb = project(b.b);
      return (zb ? zb.z : 0) - (za ? za.z : 0);
    });

    for (const pr of prongs) {
      const pb = project(pr.b), pm = project(pr.m), pt = project(pr.t);
      if (!pb || !pm || !pt) continue;
      const lw = Math.max(3.0, pb.s * 0.064);

      // 바깥쪽 어두운 크롬 외곽선 (두께감)
      ctx.beginPath();
      ctx.moveTo(pb.x, pb.y);
      ctx.quadraticCurveTo(pm.x, pm.y, pt.x, pt.y);
      ctx.strokeStyle = '#252b40';
      ctx.lineWidth = lw * 1.28;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 메인 크롬 바디
      const grad = ctx.createLinearGradient(pb.x, pb.y, pt.x, pt.y);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.35, '#c5d1f0');
      grad.addColorStop(0.7, '#6e7b9e');
      grad.addColorStop(1, '#dfe8ff');
      ctx.beginPath();
      ctx.moveTo(pb.x, pb.y);
      ctx.quadraticCurveTo(pm.x, pm.y, pt.x, pt.y);
      ctx.strokeStyle = grad;
      ctx.lineWidth = lw * 0.92;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(160, 200, 255, 0.35)';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 관절 볼트(리벳) 디테일
      for (const jt of [pb, pm]) {
        ctx.beginPath();
        ctx.arc(jt.x, jt.y, lw * 0.48, 0, TAU);
        ctx.fillStyle = '#e8efff';
        ctx.fill();
        ctx.lineWidth = Math.max(1, lw * 0.16);
        ctx.strokeStyle = '#39415e';
        ctx.stroke();
      }

      // 집게 끝 핑크/레드 실리콘 그립 팁
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, lw * 0.58, 0, TAU);
      ctx.fillStyle = '#ff4fa8';
      ctx.fill();
      ctx.lineWidth = Math.max(1, lw * 0.15);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawGlassFront() {
    const { hx, hz, top } = BOX;
    const front = [[-hx, 0, hz], [hx, 0, hz], [hx, top, hz], [-hx, top, hz]];
    const ps = front.map(project).filter(Boolean);
    if (ps.length < 4) return;

    ctx.save();
    ctx.beginPath();
    ps.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.clip();

    // 유리 전체
    const g = ctx.createLinearGradient(ps[3].x, ps[3].y, ps[1].x, ps[1].y);
    g.addColorStop(0, 'rgba(150,205,255,0.16)');
    g.addColorStop(0.35, 'rgba(150,205,255,0.045)');
    g.addColorStop(1, 'rgba(255,140,220,0.07)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 반사 스트릭
    const top1 = project([-hx, top, hz]);
    const bot1 = project([-hx, 0, hz]);
    if (top1 && bot1) {
      for (let i = 0; i < 3; i++) {
        const off = (i * 0.28 + 0.1) * (ps[1].x - ps[0].x);
        ctx.beginPath();
        const sk = (ps[1].x - ps[0].x) * 0.16;
        ctx.moveTo(ps[0].x + off, ps[3].y);
        ctx.lineTo(ps[0].x + off + sk, ps[3].y);
        ctx.lineTo(ps[0].x + off + sk * 0.35, ps[1].y);
        ctx.lineTo(ps[0].x + off - sk * 0.4, ps[1].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,' + (0.028 + i * 0.012) + ')';
        ctx.fill();
      }
    }
    ctx.restore();

    // 유리 프레임 (앞면 사각)
    ctx.save();
    ctx.strokeStyle = 'rgba(120,230,255,0.75)';
    ctx.lineWidth = 2.2;
    ctx.shadowColor = 'rgba(69,233,255,0.7)';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ps.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawFrameEdges() {
    const { hx, hz, top } = BOX;
    // 뒤쪽 기둥
    for (const [a, b] of [
      [[-hx, top, -hz], [hx, top, -hz]],
      [[-hx, top, -hz], [-hx, top, hz]],
      [[hx, top, -hz], [hx, top, hz]],
      [[-hx, 0, -hz], [-hx, top, -hz]],
      [[hx, 0, -hz], [hx, top, -hz]]
    ]) {
      line3(a, b, 'rgba(140, 195, 255, 0.35)', 2.4);
    }
    // 앞쪽 양옆 실사 크롬 알루미늄 기둥 (두께감 있는 멀티 레이어 하이라이트)
    for (const sx of [-hx, hx]) {
      line3([sx, 0, hz], [sx, top, hz], '#241c4c', 10);
      line3([sx, 0, hz], [sx, top, hz], '#90b4e8', 5.2);
      line3([sx, 0, hz], [sx, top, hz], '#ffffff', 1.8);
    }
    line3([-hx, top, hz], [hx, top, hz], '#241c4c', 8);
    line3([-hx, top, hz], [hx, top, hz], '#b8d8ff', 3.4);
  }

  function drawBase() {
    const bx = BASE.x, y0 = BASE.y0, z = BASE.z;
    // 1) 하단 캐비닛 앞면 (입체 메탈릭 퍼플·네이비 도장)
    const pTop = project([0, 0, z]);
    const pBot = project([0, y0, z]);
    const g = ctx.createLinearGradient(0, pTop ? pTop.y : H * 0.65, 0, pBot ? pBot.y : H);
    g.addColorStop(0, '#322368');
    g.addColorStop(0.18, '#23184d');
    g.addColorStop(0.75, '#130c2e');
    g.addColorStop(1, '#090518');
    poly3([[-bx, y0, z], [bx, y0, z], [bx, 0, z], [-bx, 0, z]], g, 'rgba(175, 145, 255, 0.45)', 1.8);

    // 옆면
    poly3([[bx, y0, z], [bx, y0, -z], [bx, 0, -z], [bx, 0, z]], 'rgba(12, 8, 28, 0.94)', 'rgba(120, 95, 210, 0.25)', 1);
    poly3([[-bx, y0, z], [-bx, y0, -z], [-bx, 0, -z], [-bx, 0, z]], 'rgba(12, 8, 28, 0.94)', 'rgba(120, 95, 210, 0.25)', 1);

    // 2) 컨트롤 데크(조작부 선반) 상판 — 앞으로 살짝 튀어나온 아케이드 콘솔 데크
    const deckZ = z + 0.34;
    const deckY = -0.08;
    const dg = ctx.createLinearGradient(0, pTop ? pTop.y - 15 : H * 0.64, 0, pTop ? pTop.y + 22 : H * 0.68);
    dg.addColorStop(0, '#3f2e7e');
    dg.addColorStop(0.5, '#291c58');
    dg.addColorStop(1, '#181038');
    poly3([[-bx, 0, z], [bx, 0, z], [bx * 0.96, deckY, deckZ], [-bx * 0.96, deckY, deckZ]], dg, 'rgba(255, 140, 225, 0.6)', 1.6);

    // 컨트롤 데크 앞면 네온 범퍼 몰딩
    poly3([[-bx * 0.96, deckY - 0.11, deckZ], [bx * 0.96, deckY - 0.11, deckZ], [bx * 0.96, deckY, deckZ], [-bx * 0.96, deckY, deckZ]], '#160e36', 'rgba(69, 233, 255, 0.65)', 1.5);
    line3([-bx * 0.93, deckY - 0.05, deckZ + 0.01], [bx * 0.93, deckY - 0.05, deckZ + 0.01], '#ff4fa8', 3.4, 'rgba(255,79,168,0.95)', 22);

    // 3) 데크 위 실사 3D 아케이드 볼탑 조이스틱 & LED 푸시버튼
    const joyBase = project([-0.85, -0.02, z + 0.18]);
    const joyTop = project([-0.85 + (crane.vx * 0.035), 0.22, z + 0.18 + (crane.vz * 0.035)]);
    if (joyBase && joyTop) {
      // 조이스틱 와셔(검은 원판)
      ctx.beginPath();
      ctx.ellipse(joyBase.x, joyBase.y, 0.17 * joyBase.s, 0.075 * joyBase.s, 0, 0, TAU);
      ctx.fillStyle = '#0d0a1c';
      ctx.fill();
      ctx.strokeStyle = 'rgba(140, 220, 255, 0.5)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // 크롬 샤프트 막대
      ctx.beginPath();
      ctx.moveTo(joyBase.x, joyBase.y);
      ctx.lineTo(joyTop.x, joyTop.y);
      ctx.strokeStyle = '#d8e4ff';
      ctx.lineWidth = Math.max(2.5, joyBase.s * 0.042);
      ctx.lineCap = 'round';
      ctx.stroke();

      // 붉은 유광 볼탑(구슬 손잡이)
      const br = 0.125 * joyTop.s;
      const bg = ctx.createRadialGradient(joyTop.x - br * 0.35, joyTop.y - br * 0.35, 1, joyTop.x, joyTop.y, br);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(0.25, '#ff7eb9');
      bg.addColorStop(0.65, '#ff1f7a');
      bg.addColorStop(1, '#7a0536');
      ctx.fillStyle = bg;
      ctx.shadowColor = 'rgba(255, 50, 140, 0.8)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(joyTop.x, joyTop.y, br, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // 데크 위 발광 아케이드 버튼 2개 (시안 & 골드)
    for (const [bxPos, bCol, bGlow] of [[0.45, '#45e9ff', 'rgba(69,233,255,0.85)'], [0.95, '#ffd76a', 'rgba(255,215,106,0.85)']]) {
      const bp = project([bxPos, -0.01, z + 0.18]);
      if (bp) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(bp.x, bp.y + 2, 0.15 * bp.s, 0.072 * bp.s, 0, 0, TAU);
        ctx.fillStyle = '#140f2d';
        ctx.fill();

        ctx.shadowColor = bGlow;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.ellipse(bp.x, bp.y - 1.5, 0.115 * bp.s, 0.054 * bp.s, 0, 0, TAU);
        ctx.fillStyle = bCol;
        ctx.fill();
        ctx.restore();
      }
    }

    // 4) 하단 네온 몰딩 & 스피커 그릴 & 코인 메커니즘
    line3([-bx + 0.15, -0.88, z + 0.01], [bx - 0.15, -0.88, z + 0.01], 'rgba(69,233,255,0.55)', 2.2, 'rgba(69,233,255,0.6)', 14);

    // 왼쪽 코인 도어 (금속 패널 + 발광 코인 투입구 + 디지털 크레딧 창)
    poly3([[-2.72, -0.78, z + 0.01], [-1.58, -0.78, z + 0.01], [-1.58, -0.24, z + 0.01], [-2.72, -0.24, z + 0.01]], 'rgba(14, 10, 32, 0.95)', 'rgba(160, 145, 230, 0.45)', 1.5);
    const cp = project([-2.15, -0.51, z + 0.02]);
    if (cp) {
      const s = cp.s;
      // 코인 슬롯
      ctx.fillStyle = 'rgba(255, 215, 106, 0.18)';
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 1.6;
      roundRect(cp.x - 0.36 * s, cp.y - 0.15 * s, 0.30 * s, 0.30 * s, 6);
      ctx.fill();
      ctx.stroke();

      // 동전 투입 구멍
      ctx.fillStyle = '#ff4fa8';
      ctx.shadowColor = '#ff4fa8';
      ctx.shadowBlur = 8;
      ctx.fillRect(cp.x - 0.22 * s, cp.y - 0.07 * s, 0.025 * s, 0.14 * s);
      ctx.shadowBlur = 0;

      // FREE PLAY LED 배지
      ctx.fillStyle = '#071a1e';
      ctx.strokeStyle = 'rgba(69, 233, 255, 0.6)';
      roundRect(cp.x + 0.02 * s, cp.y - 0.12 * s, 0.38 * s, 0.24 * s, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#4dffa8';
      ctx.font = `900 ${Math.max(7, 0.068 * s)}px ui-monospace, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FREE', cp.x + 0.21 * s, cp.y - 0.03 * s);
      ctx.fillText('PLAY', cp.x + 0.21 * s, cp.y + 0.055 * s);
    }

    // 중앙 스테레오 스피커 그릴
    const spk = project([-0.15, -0.52, z + 0.02]);
    if (spk) {
      ctx.fillStyle = 'rgba(200, 190, 255, 0.18)';
      for (let r = -2; r <= 2; r++) {
        for (let c = -6; c <= 6; c++) {
          ctx.beginPath();
          ctx.arc(spk.x + c * 0.075 * spk.s, spk.y + r * 0.055 * spk.s, Math.max(1, 0.014 * spk.s), 0, TAU);
          ctx.fill();
        }
      }
    }

    // 5) 오른쪽 경품 배출구 도어 (입체 플랩 & 내부 네온 글로우)
    const dx0 = 1.52, dx1 = 2.68, dy0 = -0.80, dy1 = -0.22;
    poly3([[dx0, dy0, z + 0.01], [dx1, dy0, z + 0.01], [dx1, dy1, z + 0.01], [dx0, dy1, z + 0.01]], 'rgba(4, 3, 14, 0.97)', 'rgba(69, 233, 255, 0.72)', 2.0);
    poly3([[dx0 + 0.07, dy0 + 0.06, z + 0.015], [dx1 - 0.07, dy0 + 0.06, z + 0.015], [dx1 - 0.07, dy1 - 0.06, z + 0.015], [dx0 + 0.07, dy1 - 0.06, z + 0.015]], 'rgba(20, 45, 72, 0.35)', 'rgba(150, 240, 255, 0.28)', 1.0);
    const dp = project([(dx0 + dx1) / 2, (dy0 + dy1) / 2, z + 0.02]);
    if (dp) {
      ctx.save();
      ctx.shadowColor = 'rgba(69, 233, 255, 0.8)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(130, 245, 255, 0.75)';
      ctx.font = `900 ${Math.max(8, 0.095 * dp.s)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✦ PRIZE OUT ✦', dp.x, dp.y);
      ctx.restore();
    }
  }

  function drawMarquee() {
    const y0 = 4.42, y1 = 5.5, z = 2.03, x = 3.16;

    // 상판
    poly3([[-x, y0, -1.72], [x, y0, -1.72], [x, y0, z], [-x, y0, z]], 'rgba(18,13,40,0.95)');

    // 뒷면 박스
    poly3([[-x, y0, z - 0.28], [x, y0, z - 0.28], [x, y1, z - 0.28], [-x, y1, z - 0.28]], '#120d2c');

    // 앞면
    const grd = ctx.createLinearGradient(0, project([0, y1, z]).y, 0, project([0, y0, z]).y);
    grd.addColorStop(0, '#2a1a5c');
    grd.addColorStop(0.55, '#1a1038');
    grd.addColorStop(1, '#120a26');
    poly3([[-x, y0, z], [x, y0, z], [x, y1, z], [-x, y1, z]], grd, 'rgba(255,120,220,0.55)', 2);

    const pBL = project([-x, y0, z]);
    const pBR = project([x, y0, z]);
    const pTL = project([-x, y1, z]);
    const pTR = project([x, y1, z]);
    if (!pBL || !pBR || !pTL || !pTR) return;

    const cx = (pBL.x + pBR.x) / 2;
    const cy = (pTL.y + pBL.y) / 2;
    const panelH = Math.abs(pBL.y - pTL.y);
    const panelW = Math.abs(pBR.x - pBL.x);

    // 전구 테두리
    const bulbN = 14;
    for (let i = 0; i <= bulbN; i++) {
      const t = i / bulbN;
      for (const edge of [[pBL, pBR], [pTL, pTR]]) {
        const gx = lerp(edge[0].x, edge[1].x, t);
        const gy = lerp(edge[0].y, edge[1].y, t);
        const flick = 0.55 + 0.45 * Math.sin(clock.t * 3.2 + i * 0.9);
        const r = Math.max(1.6, panelH * 0.028);
        const gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 3.6);
        gg.addColorStop(0, `rgba(255,240,190,${0.95 * flick})`);
        gg.addColorStop(0.3, `rgba(255,190,120,${0.5 * flick})`);
        gg.addColorStop(1, 'rgba(255,150,90,0)');
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(gx, gy, r * 3.6, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(gx, gy, r, 0, TAU);
        ctx.fillStyle = `rgba(255,248,220,${0.75 + 0.25 * flick})`;
        ctx.fill();
      }
    }

    // 타이틀 텍스트
    ctx.save();
    ctx.translate(cx, cy);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let fontSize = Math.max(12, panelH * 0.44);
    ctx.font = `900 ${fontSize}px system-ui, "Segoe UI", "Malgun Gothic", sans-serif`;
    let mw = ctx.measureText('LUCKY GRAB').width;
    const targetW = panelW * 0.84;
    if (mw > targetW) {
      fontSize *= targetW / mw;
      ctx.font = `900 ${fontSize}px system-ui, "Segoe UI", "Malgun Gothic", sans-serif`;
      mw = ctx.measureText('LUCKY GRAB').width;
    }
    const tg = ctx.createLinearGradient(0, -fontSize * 0.6, 0, fontSize * 0.6);
    tg.addColorStop(0, '#ffffff');
    tg.addColorStop(0.45, '#ffd9f1');
    tg.addColorStop(1, '#ff5fb2');
    ctx.shadowColor = 'rgba(255,80,170,0.85)';
    ctx.shadowBlur = panelH * 0.22;
    ctx.fillStyle = tg;
    ctx.fillText('LUCKY GRAB', 0, -panelH * 0.08);
    ctx.shadowBlur = 0;

    // 서브 텍스트
    ctx.font = `700 ${Math.max(7, panelH * 0.13)}px system-ui, "Malgun Gothic", sans-serif`;
    ctx.fillStyle = 'rgba(150,240,255,0.9)';
    ctx.shadowColor = 'rgba(69,233,255,0.9)';
    ctx.shadowBlur = panelH * 0.12;
    ctx.fillText('LUCKY  DRAW  ·  QR  CONTROLLER', 0, panelH * 0.3);
    ctx.restore();
  }

  function drawTopCap() {
    const { hx, hz, top } = BOX;
    poly3([[-hx, top, -hz], [hx, top, -hz], [hx, top, hz], [-hx, top, hz]], 'rgba(30,22,62,0.65)', 'rgba(150,215,255,0.3)', 1.2);
    // 상단 테두리 박스
    poly3([[-hx - 0.1, top, hz], [hx + 0.1, top, hz], [hx + 0.1, 4.42, hz], [-hx - 0.1, 4.42, hz]], 'rgba(26,18,54,0.95)', 'rgba(150,215,255,0.25)', 1);
  }

  function drawDust() {
    // 유리 안 먼지/반짝임
    ctx.save();
    for (let i = 0; i < 26; i++) {
      const t = clock.t * 0.25 + i * 1.37;
      const x = -2.6 + ((Math.sin(t * 0.7 + i) * 0.5 + 0.5) * 5.2);
      const z = -1.6 + ((Math.cos(t * 0.5 + i * 2.1) * 0.5 + 0.5) * 3.2);
      const y = 0.6 + ((Math.sin(t * 0.33 + i * 0.7) * 0.5 + 0.5) * 3.2);
      const p = project([x, y, z]);
      if (!p) continue;
      const a = 0.10 + 0.22 * (0.5 + 0.5 * Math.sin(clock.t * 1.7 + i));
      ctx.fillStyle = `rgba(200,230,255,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.6, p.s * 0.012), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawScene() {
    drawBackdrop();
    drawFloorShadow();
    drawInterior();
    drawCapsules();
    drawAimRing();
    drawCrane();
    if (anim && anim.capsulePos) drawHeldCapsule(anim.capsulePos, anim.prize);
    if (falling) drawHeldCapsule([falling.x, falling.y, falling.z], falling.prize, falling.life > 0 ? 1 : 1);
    drawDust();
    drawGlassFront();
    drawFrameEdges();
    drawTopCap();
    drawBase();
    drawMarquee();
  }

  /* ------------------------------------------------------------- animation */
  let lastTs = performance.now();
  function frame(ts) {
    const dt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
    lastTs = ts;
    clock.t += dt;

    // 레이아웃 보간
    const k = 1 - Math.exp(-5.5 * dt);
    layout.cur.x = lerp(layout.cur.x, layout.target.x, k);
    layout.cur.y = lerp(layout.cur.y, layout.target.y, k);
    layout.cur.w = lerp(layout.cur.w, layout.target.w, k);
    layout.cur.h = lerp(layout.cur.h, layout.target.h, k);
    fitCamera();

    updateCrane(dt);
    updatePile(dt);
    if (falling) updateFalling(dt);
    updateParticles(dt);

    ctx.clearRect(0, 0, W, H);
    drawScene();
    drawParticles();

    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ net */
  const net = {
    ws: null,
    retryTimer: null,
    send(obj) {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify(obj));
        return true;
      }
      return false;
    },
    connect() {
      clearTimeout(this.retryTimer);
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try {
        ws = new WebSocket(proto + '//' + location.host + '/ws');
      } catch (e) {
        this.retryTimer = setTimeout(() => this.connect(), 2000);
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        S.connected = true;
        this.send({ type: 'hello', role: 'display' });
        updateUI();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        handleMessage(msg);
      };
      ws.onclose = () => {
        S.connected = false;
        updateUI();
        this.retryTimer = setTimeout(() => this.connect(), 1400);
      };
      ws.onerror = () => { try { ws.close(); } catch (e) { /* noop */ } };
    }
  };

  function handleMessage(msg) {
    switch (msg.type) {
      case 'hello':
        S.config = msg.config;
        if (msg.config && msg.config.title && msg.config.subtitle) elBrandSub.textContent = msg.config.subtitle;
        if (msg.config && msg.config.settings) applyUiSettings(msg.config.settings, false);
        setupQR(msg.config);
        if (msg.config && msg.config.prizes) {
          const hadPrizes = S.prizes.length > 0;
          S.prizes = msg.config.prizes;
          renderPrizes();
          // 경품 목록을 받은 뒤 캡슐 더미를 경품 색으로 다시 채웁니다
          if (!hadPrizes || !capsules.length) buildPile();
        }
        break;
      case 'settings':
        if (msg.settings) applyUiSettings(msg.settings, false);
        break;
      case 'state':
        S.phase = msg.phase;
        S.controllerCount = msg.controllerCount;
        S.activeLabel = msg.activeLabel;
        S.queueLength = msg.queueLength;
        if (msg.prizes) { S.prizes = msg.prizes; renderPrizes(); }
        updateUI();
        break;
      case 'prizes':
        S.prizes = msg.prizes;
        renderPrizes();
        break;
      case 'input':
        input.x = clamp(msg.x || 0, -1, 1);
        input.z = clamp(msg.z || 0, -1, 1);
        break;
      case 'grab_start':
        input.x = 0; input.z = 0;
        startGrabAnim(msg.prize, msg.playerLabel);
        break;
      case 'result':
        S.phase = 'result';
        S.lastPrize = msg.prize;
        updateUI();
        if (msg.prizes) { S.prizes = msg.prizes; renderPrizes(); }
        break;
      case 'notice':
        flashNotice(msg.text);
        break;
      default:
        break;
    }
  }

  let noticeTimer = null;
  function flashNotice(text) {
    elStatusText.textContent = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(updateUI, 3200);
  }

  function celebrate(prize, playerLabel) {
    const p = project([0, 2.7, 0]);
    const origin = p ? { x: p.x, y: p.y } : { x: W / 2, y: H * 0.5 };
    burstConfetti(origin, prize.color || '#ff4fa8');
    confettiRain();
    showBanner(prize, playerLabel);
    if (navigator.vibrate) { try { navigator.vibrate([20, 40, 20, 40, 60]); } catch (e) {} }
  }

  // 화면 위에서 내려오는 색종이
  function confettiRain() {
    const palette = ['#ffffff', '#ffd76a', '#45e9ff', '#ff4fa8', '#a78bfa', '#7CFFB2'];
    for (let i = 0; i < 90; i++) {
      particles.push({
        x: rand(0, W),
        y: rand(-H * 0.4, -10),
        vx: rand(-70, 70),
        vy: rand(90, 300),
        w: rand(5, 12),
        h: rand(9, 20),
        rot: rand(0, TAU),
        vr: rand(-7, 7),
        color: palette[(Math.random() * palette.length) | 0],
        life: rand(6, 9),
        age: 0,
        round: Math.random() < 0.3
      });
    }
  }

  let bannerTimer = null;
  function showBanner(prize, playerLabel) {
    elBannerPrize.textContent = prize.name;
    elBannerPlayer.textContent = playerLabel ? playerLabel + ' 님 당첨' : '';
    elBannerGlow.style.background =
      'radial-gradient(circle, ' + rgba(prize.color || '#ff4fa8', 0.28) + ', rgba(0,0,0,0) 58%)';
    elBanner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => elBanner.classList.remove('show'), 5600);
  }

  /* ------------------------------------------------------------------- UI */
  function updateUI() {
    const online = S.connected || S.standalone;
    const cls = ['status'];
    let text = '';

    if (!online) {
      text = '서버에 다시 연결하는 중…';
    } else if (S.phase === 'result' && S.lastPrize) {
      text = '🎉 ' + S.lastPrize.name + ' 당첨!';
      cls.push('win');
    } else if (S.phase === 'grabbing') {
      text = (S.activeLabel || '플레이어') + ' 뽑기 진행 중…';
      cls.push('busy');
    } else if (S.controllerCount === 0) {
      text = S.standalone ? '터치 패드 또는 QR 스캔으로 조작 가능' : '터치 패드 · 컨트롤러 대기 중';
      cls.push('online');
    } else {
      text = (S.activeLabel || '플레이어') + ' 조작 중';
      cls.push('online');
    }

    elStatus.className = cls.join(' ');
    elStatusText.textContent = text;
    elQueue.textContent = S.controllerCount > 1 ? `대기 ${S.controllerCount - 1}명` : '';

    const tpGrabBtn = $('tpGrab');
    if (tpGrabBtn) tpGrabBtn.disabled = (S.phase === 'grabbing' || anim !== null);

    elKbHint.classList.toggle('hide', S.controllerCount > 0 || S.padVisible);
  }

  function setupQR(cfg) {
    let url = '';
    if (cfg && cfg.urls && (cfg.urls.lan || cfg.urls.local)) {
      url = cfg.urls.lan || cfg.urls.local;
    } else {
      const base = location.origin + location.pathname.replace(/[^/]*$/, '');
      url = base + 'controller.html' + (S.room ? '?room=' + S.room : '');
    }
    elQrUrl.textContent = url.replace(/^https?:\/\//, '');
    const roomWrap = $('qrRoomWrap');
    const roomCode = $('roomCode');
    if (roomWrap && roomCode && S.room && !S.connected) {
      roomWrap.hidden = false;
      roomCode.textContent = S.room;
    } else if (roomWrap && S.connected) {
      roomWrap.hidden = true;
    }
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      elQr.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch (e) {
      elQr.textContent = url;
    }
  }

  function renderPrizes() {
    elPrizeList.innerHTML = '';
    for (const p of S.prizes) {
      const chip = document.createElement('div');
      chip.className = 'prize-chip' + (p.remaining <= 0 ? ' out' : '');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.setProperty('--c', p.color);
      const nm = document.createElement('span');
      nm.textContent = (p.emoji ? p.emoji + ' ' : '') + p.name;
      const ct = document.createElement('span');
      ct.className = 'count';
      ct.textContent = '×' + p.remaining;
      chip.append(sw, nm, ct);
      elPrizeList.appendChild(chip);
    }
  }

  /* ---------------------------------------------------------------- input */
  const keyMap = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
    A: [-1, 0], D: [1, 0], W: [0, -1], S: [0, 1]
  };
  const pressed = new Set();

  function syncKeyboard() {
    let x = 0, z = 0;
    for (const k of pressed) {
      const v = keyMap[k];
      if (!v) continue;
      x += v[0]; z += v[1];
    }
    kb.x = clamp(x, -1, 1);
    kb.z = clamp(z, -1, 1);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) tryLocalGrab();
      return;
    }
    if (keyMap[e.key]) {
      pressed.add(e.key);
      syncKeyboard();
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (keyMap[e.key]) {
      pressed.delete(e.key);
      syncKeyboard();
    }
  });
  window.addEventListener('blur', () => { pressed.clear(); syncKeyboard(); });

  function tryLocalGrab(label) {
    Sound.init();
    if (anim || S.phase === 'grabbing') return;
    if (S.connected) {
      net.send({ type: 'grab' });
      return;
    }
    startStandaloneGrab(label || '태블릿 터치');
  }

  /* ---------------------------------------------- 웹(정적 호스팅) 및 터치 모드 */
  function saveStandaloneStock() {
    try {
      const stock = {};
      for (const p of S.prizes) stock[p.id] = p.remaining;
      localStorage.setItem('luckygrab:stock', JSON.stringify(stock));
    } catch (e) { /* noop */ }
  }

  function loadStandalonePrizes(list) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('luckygrab:stock') || '{}') || {}; } catch (e) { saved = {}; }
    return list.map((p) => {
      const qty = Math.max(0, Number(p.quantity) || 1);
      const rem = typeof saved[p.id] === 'number' ? Math.max(0, Math.min(qty, saved[p.id])) : (typeof p.remaining === 'number' ? p.remaining : qty);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        emoji: p.emoji || '🎁',
        weight: Math.max(1, Number(p.weight) || 10),
        quantity: qty,
        remaining: rem
      };
    });
  }

  function pickStandalonePrize() {
    const avail = S.prizes.filter((p) => p.remaining > 0 && (p.weight || 1) > 0);
    if (!avail.length) return null;
    const total = avail.reduce((s, p) => s + (p.weight || 1), 0);
    let r = Math.random() * total;
    for (const p of avail) {
      r -= (p.weight || 1);
      if (r <= 0) return p;
    }
    return avail[avail.length - 1];
  }

  function startStandaloneGrab(playerLabel) {
    if (anim || S.phase === 'grabbing') return;
    const prize = pickStandalonePrize();
    if (!prize) {
      flashNotice('모든 경품이 소진되었습니다! 상단 🔄 버튼으로 재고를 채워 주세요.');
      return;
    }
    S.phase = 'grabbing';
    S.activeLabel = playerLabel || '플레이어';
    input.x = 0; input.z = 0; tp.x = 0; tp.z = 0;
    updateUI();
    publishRelay({ k: 'busy', label: S.activeLabel });
    startGrabAnim(prize, S.activeLabel);
  }

  function finishStandaloneGrab(prize, playerLabel) {
    const target = S.prizes.find((p) => p.id === prize.id);
    if (target && target.remaining > 0) target.remaining -= 1;
    saveStandaloneStock();
    S.phase = 'result';
    S.lastPrize = prize;
    renderPrizes();
    updateUI();
    publishRelay({ k: 'win', prize: { id: prize.id, name: prize.name, emoji: prize.emoji, color: prize.color }, label: playerLabel });
    setTimeout(() => {
      S.phase = 'ready';
      updateUI();
      publishRelay({ k: 'ready' });
    }, 3400);
  }

  function resetPrizeStock() {
    if (!window.confirm('경품 재고를 처음 수량으로 모두 채울까요?')) return;
    if (S.connected) {
      net.send({ type: 'reset_stock', resetStock: true });
      buildPile();
      flashNotice('🎁 경품 재고를 모두 채웠습니다!');
      return;
    }
    try { localStorage.removeItem('luckygrab:stock'); } catch (e) {}
    for (const p of S.prizes) {
      p.remaining = p.quantity || 5;
    }
    saveStandaloneStock();
    buildPile();
    renderPrizes();
    flashNotice('🎁 경품 재고를 모두 채웠습니다!');
  }

  /* ---- ntfy.sh 공개 중계 (GitHub Pages 등 정적 웹에서 스마트폰 QR 연동) ---- */
  function ensureRoomCode() {
    const fromUrl = (location.search.match(/[?&]room=([A-Za-z0-9]+)/) || [])[1];
    let saved = '';
    try { saved = localStorage.getItem('luckygrab:room') || ''; } catch (e) {}
    let room = (fromUrl || saved || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (room.length < 4) {
      const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      room = '';
      for (let i = 0; i < 6; i++) room += chars[(Math.random() * chars.length) | 0];
    }
    try { localStorage.setItem('luckygrab:room', room); } catch (e) {}
    S.room = room;
    return room;
  }

  function relayTopic() {
    return 'luckygrab-' + (S.room || 'default').toLowerCase();
  }

  function publishRelay(obj) {
    if (S.connected || !S.room) return;
    fetch('https://ntfy.sh/' + relayTopic(), {
      method: 'POST',
      body: JSON.stringify(obj),
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
    }).catch(() => {});
  }

  let relayInputExpire = null;
  let relayWs = null;
  function connectRelay() {
    if (S.connected) return;
    if (relayWs) { try { relayWs.close(); } catch (_) {} relayWs = null; }
    ensureRoomCode();
    setupQR(null);
    let ws;
    try {
      ws = new WebSocket('wss://ntfy.sh/' + relayTopic() + '/ws');
    } catch (e) {
      return;
    }
    relayWs = ws;
    ws.onopen = () => {
      S.relayConnected = true;
    };
    ws.onmessage = (ev) => {
      if (S.connected) return;
      let wrapper, msg;
      try {
        wrapper = JSON.parse(ev.data);
        if (!wrapper || wrapper.event !== 'message' || !wrapper.message) return;
        msg = JSON.parse(wrapper.message);
      } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.k === 'hello') {
        S.controllerCount = Math.max(1, S.controllerCount);
        S.activeLabel = msg.label || '스마트폰';
        updateUI();
        publishRelay({ k: 'ready' });
      } else if (msg.k === 'in') {
        input.x = clamp(Number(msg.x) || 0, -1, 1);
        input.z = clamp(Number(msg.z) || 0, -1, 1);
        clearTimeout(relayInputExpire);
        if (input.x !== 0 || input.z !== 0) {
          relayInputExpire = setTimeout(() => { input.x = 0; input.z = 0; }, 900);
        }
      } else if (msg.k === 'grab') {
        startStandaloneGrab(msg.label || '스마트폰');
      } else if (msg.k === 'settings' && msg.v) {
        applyUiSettings(msg.v, false);
      } else if (msg.k === 'reset_stock') {
        try { localStorage.removeItem('luckygrab:stock'); } catch (_) {}
        for (const p of S.prizes) p.remaining = p.quantity || 5;
        saveStandaloneStock();
        buildPile();
        renderPrizes();
        flashNotice('🎁 경품 재고를 모두 채웠습니다!');
      } else if (msg.k === 'prizes' && Array.isArray(msg.list)) {
        try { localStorage.setItem('luckygrab:prizes', JSON.stringify(msg.list)); } catch (_) {}
        S.prizes = loadStandalonePrizes(msg.list);
        buildPile();
        renderPrizes();
        flashNotice('🎁 경품 목록이 업데이트되었습니다!');
      }
    };
    ws.onclose = () => {
      S.relayConnected = false;
      if (!S.connected && relayWs === ws) setTimeout(connectRelay, 2500);
    };
  }

  function makeNewRoomCode() {
    if (!window.confirm('새 방 코드를 만들까요?\n\nQR 코드가 새 주소로 바뀝니다.')) return;
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let room = '';
    for (let i = 0; i < 6; i++) room += chars[(Math.random() * chars.length) | 0];
    try { localStorage.setItem('luckygrab:room', room); } catch (_) {}
    S.room = room;
    S.controllerCount = 0;
    connectRelay();
    flashNotice('🔑 새 방 코드: ' + room);
  }

  function enableStandaloneMode() {
    if (S.connected || S.standalone) return;
    S.standalone = true;
    S.phase = 'ready';
    ensureRoomCode();
    let customPrizes = null;
    try {
      const rawCustom = localStorage.getItem('luckygrab:prizes');
      if (rawCustom) customPrizes = JSON.parse(rawCustom);
    } catch (_) {}
    if (Array.isArray(customPrizes) && customPrizes.length) {
      S.prizes = loadStandalonePrizes(customPrizes);
      buildPile();
      renderPrizes();
      setupQR(null);
      updateUI();
    } else {
      fetch('prizes.json').then((r) => r.json()).then((raw) => {
        if (raw && raw.subtitle) elBrandSub.textContent = raw.subtitle;
        S.prizes = loadStandalonePrizes(Array.isArray(raw.prizes) ? raw.prizes : DEFAULT_PRIZES);
        buildPile();
        renderPrizes();
        setupQR(null);
        updateUI();
      }).catch(() => {
        S.prizes = loadStandalonePrizes(DEFAULT_PRIZES);
        buildPile();
        renderPrizes();
        setupQR(null);
        updateUI();
      });
    }
    connectRelay();
  }

  /* ---- 화면 터치 패드 이벤트 ---- */
  function setupTouchPad() {
    const pad = $('touchPad');
    const dpad = $('tpDpad');
    const grabBtn = $('tpGrab');
    if (!pad || !dpad || !grabBtn) return;

    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const active = new Set();

    function syncTp() {
      let x = 0, z = 0;
      for (const d of active) {
        const v = DIRS[d];
        if (v) { x += v[0]; z += v[1]; }
      }
      tp.x = clamp(x, -1, 1);
      tp.z = clamp(z, -1, 1);
    }

    for (const btn of dpad.querySelectorAll('.tp-btn')) {
      const dir = btn.dataset.dir;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        Sound.init();
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
        active.add(dir);
        btn.classList.add('active');
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) {} }
        syncTp();
      });
      const release = () => {
        if (!active.has(dir)) return;
        active.delete(dir);
        btn.classList.remove('active');
        syncTp();
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('pointerleave', (e) => { if (e.buttons === 0) release(); });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    grabBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (grabBtn.disabled) return;
      grabBtn.classList.add('pressed');
      if (navigator.vibrate) { try { navigator.vibrate(18); } catch (_) {} }
      active.clear();
      for (const b of dpad.querySelectorAll('.tp-btn')) b.classList.remove('active');
      syncTp();
      tryLocalGrab('태블릿 터치');
    });
    const unpress = () => grabBtn.classList.remove('pressed');
    grabBtn.addEventListener('pointerup', unpress);
    grabBtn.addEventListener('pointercancel', unpress);
    grabBtn.addEventListener('pointerleave', unpress);
    grabBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    const padToggle = $('padToggleBtn');
    if (padToggle) {
      padToggle.addEventListener('click', () => {
        S.padVisible = !S.padVisible;
        pad.classList.toggle('hidden', !S.padVisible);
        updateUI();
      });
    }
    const qrToggle = $('qrToggleBtn');
    if (qrToggle) {
      qrToggle.addEventListener('click', () => {
        S.qrExpanded = !S.qrExpanded;
        elQrPanel.classList.toggle('compact', !S.qrExpanded);
        layout.target = computeTargetRect();
      });
    }
    const resetBtn = $('resetStockBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', resetPrizeStock);
    }
    const newRoomBtn = $('newRoomBtn');
    if (newRoomBtn) {
      newRoomBtn.addEventListener('click', makeNewRoomCode);
    }

    window.addEventListener('storage', (ev) => {
      if (!ev.key) return;
      if (ev.key === 'luckygrab:uiSettings' && ev.newValue) {
        try { applyUiSettings(JSON.parse(ev.newValue), false); } catch (_) {}
      } else if (ev.key === 'luckygrab:prizes' && ev.newValue) {
        try {
          S.prizes = loadStandalonePrizes(JSON.parse(ev.newValue));
          buildPile();
          renderPrizes();
        } catch (_) {}
      } else if (ev.key === 'luckygrab:stock') {
        S.prizes = loadStandalonePrizes(S.prizes);
        renderPrizes();
      } else if (ev.key === 'luckygrab:room' && ev.newValue && ev.newValue !== S.room) {
        S.room = ev.newValue;
        connectRelay();
      }
    });

    setupAdminPanel();
  }

  function applyUiSettings(patch, persist) {
    if (patch && typeof patch === 'object') {
      S.uiSettings = Object.assign({}, S.uiSettings, patch);
    }
    const u = S.uiSettings;
    const fs = clamp(Number(u.fontScale) || 100, 70, 160);
    const qs = clamp(Number(u.qrSize) || 100, 70, 140);
    const pos = u.qrPosition || 'right';
    const vis = u.qrVisible !== false;

    document.documentElement.style.setProperty('--font-scale', (fs / 100).toFixed(2));
    document.documentElement.style.setProperty('--qr-scale', (qs / 100).toFixed(2));

    elQrPanel.classList.remove('pos-right', 'pos-bottom-right', 'pos-bottom-left', 'pos-top-right', 'pos-top-left', 'pos-bottom-center');
    if (pos !== 'right') elQrPanel.classList.add('pos-' + pos);
    elQrPanel.classList.toggle('hidden', !vis);

    const fInp = $('admFontScale'), fVal = $('admFontVal');
    const pSel = $('admQrPos');
    const sInp = $('admQrSize'), sVal = $('admQrSizeVal');
    const vChk = $('admQrVis');
    if (fInp) fInp.value = fs;
    if (fVal) fVal.textContent = fs + '%';
    if (pSel) pSel.value = pos;
    if (sInp) sInp.value = qs;
    if (sVal) sVal.textContent = qs + '%';
    if (vChk) vChk.checked = vis;

    layout.target = computeTargetRect();

    if (persist !== false) {
      try { localStorage.setItem('luckygrab:uiSettings', JSON.stringify(S.uiSettings)); } catch (_) {}
      if (S.connected) {
        net.send({ type: 'settings', settings: S.uiSettings });
      }
    }
  }

  function setupAdminPanel() {
    const panel = $('adminPanel');
    const toggleBtn = $('adminToggleBtn');
    const closeBtn = $('adminCloseBtn');
    const fInp = $('admFontScale');
    const pSel = $('admQrPos');
    const sInp = $('admQrSize');
    const vChk = $('admQrVis');
    const resetUiBtn = $('admResetUiBtn');
    const resetStockAdm = $('admResetStockBtn');

    applyUiSettings(S.uiSettings, false);

    if (toggleBtn && panel) {
      toggleBtn.addEventListener('click', () => {
        panel.classList.toggle('hidden');
      });
    }
    if (closeBtn && panel) {
      closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
    }
    if (fInp) {
      fInp.addEventListener('input', () => applyUiSettings({ fontScale: Number(fInp.value) }, true));
    }
    if (pSel) {
      pSel.addEventListener('change', () => applyUiSettings({ qrPosition: pSel.value }, true));
    }
    if (sInp) {
      sInp.addEventListener('input', () => applyUiSettings({ qrSize: Number(sInp.value) }, true));
    }
    if (vChk) {
      vChk.addEventListener('change', () => applyUiSettings({ qrVisible: vChk.checked }, true));
    }
    if (resetUiBtn) {
      resetUiBtn.addEventListener('click', () => applyUiSettings(DEFAULT_UI_SETTINGS, true));
    }
    if (resetStockAdm) {
      resetStockAdm.addEventListener('click', resetPrizeStock);
    }
  }

  /* --------------------------------------------------------------- sound */
  const Sound = {
    ctx: null,
    enabled: true,
    init() {
      if (!this.enabled) return;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { this.ctx = new AC(); } catch (e) { return; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq, dur, type, gain, slideTo) {
      if (!this.enabled || !this.ctx) return;
      const t0 = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    },
    win() {
      if (!this.enabled) return;
      this.init();
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.42, 'triangle', 0.06), i * 105));
      setTimeout(() => this.tone(1568, 0.7, 'sine', 0.035), 600);
    },
    thud() {
      this.init();
      this.tone(180, 0.16, 'sine', 0.08, 70);
    },
    tick() {
      this.init();
      this.tone(880, 0.05, 'square', 0.02);
    }
  };

  document.addEventListener('pointerdown', () => Sound.init(), { once: true });

  $('soundBtn').addEventListener('click', (e) => {
    Sound.enabled = !Sound.enabled;
    e.currentTarget.textContent = Sound.enabled ? '🔈' : '🔇';
    if (Sound.enabled) { Sound.init(); Sound.tick(); }
  });

  $('fullBtn').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) { /* noop */ }
  });

  /* ----------------------------------------------------------------- boot */
  // 디버깅/자동 점검용 핸들 (화면 표시에는 영향 없음)
  window.LUCKY = {
    S, crane,
    get capsules() { return capsules; },
    get anim() { return anim; },
    grab: () => tryLocalGrab(),
    startGrabAnim, showBanner, celebrate
  };

  window.addEventListener('resize', resize);
  setupTouchPad();
  resize();
  buildPile();
  renderPrizes();
  updateUI();
  // GitHub Pages 또는 file:// 로 열었을 때는 기다리지 않고 즉시 태블릿 웹 단독+QR중계 모드로 시작!
  if (/\.github\.io$/i.test(location.hostname) || location.protocol === 'file:') {
    enableStandaloneMode();
  } else {
    net.connect();
    setTimeout(() => {
      if (!S.connected) enableStandaloneMode();
    }, 1000);
  }
  requestAnimationFrame(frame);
  // 화면 갱신 (연결 상태 주기 점검)
  setInterval(() => {
    if (!S.connected && !S.standalone) updateUI();
  }, 2000);
})();
