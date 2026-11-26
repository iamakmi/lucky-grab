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
  const S = {
    connected: false,
    controllerCount: 0,
    phase: 'idle',
    activeLabel: null,
    queueLength: 0,
    prizes: [],
    config: null,
    lastPrize: null,
    qrExpanded: true
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
    const qrOpen = S.qrExpanded;
    return {
      x: W * (qrOpen ? 0.028 : 0.09),
      y: H * 0.105,
      w: W * (qrOpen ? 0.705 : 0.815),
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
    const key = prize.id + '|' + prize.color;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const SZ = 168;
    const c = document.createElement('canvas');
    c.width = c.height = SZ;
    const g = c.getContext('2d');
    const cx = SZ / 2, cy = SZ / 2, R = SZ / 2 - 7;
    const col = prize.color || '#9aa7ff';

    const grad = g.createRadialGradient(cx - R * 0.34, cy - R * 0.4, R * 0.05, cx, cy, R * 1.02);
    grad.addColorStop(0, mixHex(col, '#ffffff', 0.78));
    grad.addColorStop(0.3, mixHex(col, '#ffffff', 0.34));
    grad.addColorStop(0.68, col);
    grad.addColorStop(1, mixHex(col, '#05030f', 0.62));
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.fillStyle = grad;
    g.fill();

    // 캡슐 이음선 (위·아래 반쪽)
    g.save();
    g.beginPath();
    g.arc(cx, cy, R * 0.996, 0, TAU);
    g.clip();

    // 아래 반쪽을 살짝 어둡게
    g.beginPath();
    g.ellipse(cx, cy - R * 0.02, R * 1.02, R * 0.30, 0, 0, Math.PI);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fill();

    // 이음선
    g.beginPath();
    g.ellipse(cx, cy - R * 0.02, R * 1.0, R * 0.30, 0, 0, TAU);
    g.strokeStyle = 'rgba(255,255,255,0.42)';
    g.lineWidth = R * 0.055;
    g.stroke();
    g.beginPath();
    g.ellipse(cx, cy - R * 0.02 + R * 0.05, R * 1.0, R * 0.28, 0, 0, Math.PI);
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = R * 0.05;
    g.stroke();
    g.restore();

    // 림 라이트
    g.beginPath();
    g.arc(cx, cy, R * 0.94, Math.PI * 1.05, Math.PI * 1.62);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = R * 0.055;
    g.lineCap = 'round';
    g.stroke();

    // 하이라이트
    const hg = g.createRadialGradient(cx - R * 0.36, cy - R * 0.42, 0, cx - R * 0.36, cy - R * 0.42, R * 0.56);
    hg.addColorStop(0, 'rgba(255,255,255,0.92)');
    hg.addColorStop(0.4, 'rgba(255,255,255,0.30)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hg;
    g.beginPath();
    g.arc(cx - R * 0.36, cy - R * 0.42, R * 0.56, 0, TAU);
    g.fill();

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

    const useController = S.controllerCount > 0;
    const ix = useController ? input.x : kb.x;
    const iz = useController ? input.z : kb.z;
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
        net.send({ type: 'grab_done' });
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
      net.send({ type: 'grab_done' });
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

    // 무대 조명
    const g = ctx.createRadialGradient(W * 0.5, H * 0.28, 10, W * 0.5, H * 0.42, Math.max(W, H) * 0.62);
    g.addColorStop(0, 'rgba(120,90,255,0.22)');
    g.addColorStop(0.45, 'rgba(90,40,180,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 바닥 반사
    const fy = H * 0.86;
    const fg = ctx.createRadialGradient(W * 0.5, fy, 10, W * 0.5, fy, W * 0.45);
    fg.addColorStop(0, 'rgba(255,80,180,0.16)');
    fg.addColorStop(0.5, 'rgba(120,60,220,0.08)');
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, fy - H * 0.3, W, H * 0.5);

    // 별
    ctx.save();
    for (let i = 0; i < 46; i++) {
      const seed = i * 97.13;
      const x = ((Math.sin(seed) * 0.5 + 0.5) * W);
      const y = ((Math.cos(seed * 1.7) * 0.5 + 0.5) * H * 0.8);
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clock.t * 1.6 + i));
      ctx.globalAlpha = 0.10 + tw * 0.20;
      ctx.fillStyle = i % 5 === 0 ? '#ff9bd4' : '#bcd6ff';
      ctx.beginPath();
      ctx.arc(x, y, (i % 7 === 0 ? 1.7 : 1.0), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFloorShadow() {
    const c = project([0, 0.0, 0]);
    if (!c) return;
    ctx.save();
    ctx.translate(c.x, c.y + 12 * (c.s / 100));
    ctx.scale(1, 0.32);
    const r = 3.6 * c.s;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawInterior() {
    const { hx, hz, top } = BOX;

    // 뒷면 패널
    const bp = ctx.createLinearGradient(0, 0, 0, H);
    bp.addColorStop(0, '#1b1445');
    bp.addColorStop(0.55, '#120c2e');
    bp.addColorStop(1, '#0a0720');
    poly3([[-hx, 0.02, -hz], [hx, 0.02, -hz], [hx, top, -hz], [-hx, top, -hz]], bp);

    // 뒷면 네온 라인
    for (let i = 0; i < 3; i++) {
      const y = 0.5 + i * 1.35;
      line3([-hx + 0.1, y, -hz + 0.02], [hx - 0.1, y, -hz + 0.02], 'rgba(140,110,255,0.10)', 1.2);
    }

    // 유리 상자 안쪽 상단 조명
    for (const [yy, col, glow] of [[3.86, 'rgba(255,140,220,0.55)', 'rgba(255,79,168,0.5)'], [3.7, 'rgba(120,230,255,0.45)', 'rgba(69,233,255,0.45)']]) {
      line3([-hx + 0.18, yy, hz - 0.14], [hx - 0.18, yy, hz - 0.14], col, 2.4, glow, 22);
    }

    // 바닥의 은은한 스포트라이트
    const sp = project([0, 0, 0]);
    if (sp) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g2 = ctx.createRadialGradient(sp.x, sp.y - 0.9 * sp.s, 4, sp.x, sp.y, 3.4 * sp.s);
      g2.addColorStop(0, 'rgba(180,160,255,0.10)');
      g2.addColorStop(1, 'rgba(180,160,255,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, 3.2 * sp.s, 1.5 * sp.s, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // 옆면 유리
    poly3([[-hx, 0, -hz], [-hx, 0, hz], [-hx, top, hz], [-hx, top, -hz]], 'rgba(120,160,255,0.05)');
    poly3([[hx, 0, -hz], [hx, 0, hz], [hx, top, hz], [hx, top, -hz]], 'rgba(255,120,220,0.045)');

    // 바닥
    const fc = project([0, 0, 0]);
    if (fc) {
      const g = ctx.createRadialGradient(fc.x, fc.y, 4, fc.x, fc.y, 4.3 * fc.s);
      g.addColorStop(0, '#241a52');
      g.addColorStop(0.55, '#150f36');
      g.addColorStop(1, '#0b0822');
      poly3([[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]], g);
    }

    // 배출구
    const hole = [[CHUTE.x0, 0.005, CHUTE.z0], [CHUTE.x1, 0.005, CHUTE.z0], [CHUTE.x1, 0.005, CHUTE.z1], [CHUTE.x0, 0.005, CHUTE.z1]];
    poly3(hole, 'rgba(4,2,14,0.94)', 'rgba(69,233,255,0.55)', 2);
    const hc = project([CHUTE_C[0], 0.01, CHUTE_C[2]]);
    if (hc) {
      ctx.save();
      ctx.shadowColor = 'rgba(69,233,255,0.65)';
      ctx.shadowBlur = 26;
      ctx.beginPath();
      ctx.ellipse(hc.x, hc.y, 0.42 * hc.s, 0.16 * hc.s, 0, 0, TAU);
      ctx.fillStyle = 'rgba(69,233,255,0.07)';
      ctx.fill();
      ctx.restore();
    }
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

    // 케이블 (살짝 흔들림)
    const swayX = crane.sway * 0.12;
    const cableTop = [crane.x, railY - 0.02, bz];
    const cableBot = [crane.x + swayX, crane.hubY + 0.13, crane.z];
    line3(cableTop, cableBot, 'rgba(220,230,255,0.75)', Math.max(1.2, project(cableTop) ? project(cableTop).s * 0.012 : 2));

    // 집게 본체
    const hp = project([crane.x + swayX * 0.4, crane.hubY, crane.z]);
    if (hp) {
      const r = 0.21 * hp.s;
      const g = ctx.createLinearGradient(hp.x - r, hp.y - r, hp.x + r, hp.y + r);
      g.addColorStop(0, '#f2f5ff');
      g.addColorStop(0.45, '#9aa4c9');
      g.addColorStop(1, '#3d4460');
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y - r * 0.25, r, r * 0.55, 0, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.stroke();

      // 몸통
      ctx.beginPath();
      ctx.moveTo(hp.x - r * 0.82, hp.y - r * 0.25);
      ctx.lineTo(hp.x - r * 0.6, hp.y + r * 0.55);
      ctx.lineTo(hp.x + r * 0.6, hp.y + r * 0.55);
      ctx.lineTo(hp.x + r * 0.82, hp.y - r * 0.25);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    }

    // 집게 발 3개 (화면상 뒤쪽부터)
    const open = crane.open;
    const angles = [Math.PI * 0.5, Math.PI * 1.1666, Math.PI * 1.8333];
    const prongs = angles.map((ang) => {
      const spread = 0.12 + 0.46 * open;
      const bx = crane.x + Math.cos(ang) * 0.08;
      const bz2 = crane.z + Math.sin(ang) * 0.08;
      const by = crane.hubY - 0.03;
      const mx = crane.x + Math.cos(ang) * spread * 0.80;
      const mz = crane.z + Math.sin(ang) * spread * 0.80;
      const my = crane.hubY - 0.32;
      const tx = crane.x + Math.cos(ang) * spread * 0.60;
      const tz = crane.z + Math.sin(ang) * spread * 0.60;
      const ty = crane.hubY - 0.72;
      return { ang, b: [bx, by, bz2], m: [mx, my, mz], t: [tx, ty, tz] };
    });
    prongs.sort((a, b) => {
      const za = project(a.b), zb = project(b.b);
      return (zb ? zb.z : 0) - (za ? za.z : 0);
    });

    for (const pr of prongs) {
      const pb = project(pr.b), pm = project(pr.m), pt = project(pr.t);
      if (!pb || !pm || !pt) continue;
      const lw = Math.max(2.5, pb.s * 0.058);
      const grad = ctx.createLinearGradient(pb.x, pb.y, pt.x, pt.y);
      grad.addColorStop(0, '#eef2ff');
      grad.addColorStop(0.45, '#aab4d8');
      grad.addColorStop(1, '#5b6382');
      ctx.beginPath();
      ctx.moveTo(pb.x, pb.y);
      ctx.quadraticCurveTo(pm.x, pm.y, pt.x, pt.y);
      ctx.strokeStyle = grad;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(160,190,255,0.35)';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 손톱(안쪽 말림)
      const inX = pt.x + (pt.x - pm.x) * 0.08;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, lw * 0.55, 0, TAU);
      ctx.fillStyle = '#dfe6ff';
      ctx.fill();
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
    const edges = [
      [[-hx, top, -hz], [hx, top, -hz]],
      [[-hx, top, hz], [hx, top, hz]],
      [[-hx, top, -hz], [-hx, top, hz]],
      [[hx, top, -hz], [hx, top, hz]],
      [[-hx, 0, -hz], [-hx, top, -hz]],
      [[hx, 0, -hz], [hx, top, -hz]],
      [[-hx, 0, hz], [-hx, top, hz]],
      [[hx, 0, hz], [hx, top, hz]]
    ];
    for (const [a, b] of edges) {
      line3(a, b, 'rgba(150,215,255,0.30)', 1.8);
    }
  }

  function drawBase() {
    const bx = BASE.x, y0 = BASE.y0, z = BASE.z;
    // 앞면
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#241a4d');
    g.addColorStop(0.5, '#170f33');
    g.addColorStop(1, '#0d0821');
    poly3([[-bx, y0, z], [bx, y0, z], [bx, 0, z], [-bx, 0, z]], g, 'rgba(140,110,220,0.35)', 1.4);

    // 옆면
    poly3([[bx, y0, z], [bx, y0, -z], [bx, 0, -z], [bx, 0, z]], 'rgba(10,7,24,0.9)');
    poly3([[-bx, y0, z], [-bx, y0, -z], [-bx, 0, -z], [-bx, 0, z]], 'rgba(10,7,24,0.9)');

    // 상단 테두리
    poly3([[-bx, 0, -z], [bx, 0, -z], [bx, 0, z], [-bx, 0, z]], 'rgba(255,255,255,0.05)');

    // 네온 라인
    line3([-bx + 0.15, -0.12, z + 0.01], [bx - 0.15, -0.12, z + 0.01], 'rgba(255,79,168,0.9)', 3, 'rgba(255,79,168,0.9)', 20);
    line3([-bx + 0.15, -0.86, z + 0.01], [bx - 0.15, -0.86, z + 0.01], 'rgba(69,233,255,0.35)', 1.4);

    // 경품 배출 도어
    const dx0 = 1.55, dx1 = 2.6, dy0 = -0.78, dy1 = -0.26;
    poly3([[dx0, dy0, z + 0.01], [dx1, dy0, z + 0.01], [dx1, dy1, z + 0.01], [dx0, dy1, z + 0.01]], 'rgba(6,4,18,0.95)', 'rgba(69,233,255,0.5)', 1.6);
    const dp = project([(dx0 + dx1) / 2, (dy0 + dy1) / 2, z + 0.02]);
    if (dp) {
      ctx.fillStyle = 'rgba(69,233,255,0.22)';
      ctx.font = `700 ${Math.max(8, 0.1 * dp.s)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PRIZE', dp.x, dp.y);
    }

    // 동전 투입구 / 버튼
    const cp = project([-2.35, -0.5, z + 0.02]);
    if (cp) {
      ctx.beginPath();
      ctx.ellipse(cp.x, cp.y, 0.14 * cp.s, 0.14 * cp.s * 0.85, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,215,106,0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,106,0.7)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
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
        setupQR(msg.config);
        if (msg.config && msg.config.prizes) {
          const hadPrizes = S.prizes.length > 0;
          S.prizes = msg.config.prizes;
          renderPrizes();
          // 경품 목록을 받은 뒤 캡슐 더미를 경품 색으로 다시 채웁니다
          if (!hadPrizes || !capsules.length) buildPile();
        }
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
    const online = S.connected;
    const cls = ['status'];
    let text = '';

    if (!online) {
      text = '서버에 다시 연결하는 중…';
    } else if (S.phase === 'result' && S.lastPrize) {
      text = '🎉 ' + S.lastPrize.name + ' 당첨!';
      cls.push('win');
    } else if (S.controllerCount === 0) {
      text = '컨트롤러 연결 대기 중';
    } else if (S.phase === 'grabbing') {
      text = (S.activeLabel || '플레이어') + ' 뽑기 진행 중…';
      cls.push('busy');
    } else {
      text = (S.activeLabel || '플레이어') + ' 조작 중';
      cls.push('online');
    }
    if (online && S.controllerCount === 0) cls.push('busy');

    elStatus.className = cls.join(' ');
    elStatusText.textContent = text;
    elQueue.textContent = S.controllerCount > 1 ? `대기 ${S.controllerCount - 1}명` : '';

    const expanded = S.controllerCount === 0;
    if (expanded !== S.qrExpanded) {
      S.qrExpanded = expanded;
      elQrPanel.classList.toggle('compact', !expanded);
      layout.target = computeTargetRect();
    }
    elKbHint.classList.toggle('hide', S.controllerCount > 0);
  }

  function setupQR(cfg) {
    if (!cfg) return;
    const lan = cfg.urls && cfg.urls.lan;
    const local = cfg.urls && cfg.urls.local;
    const url = lan || local || (location.origin + '/controller');
    elQrUrl.textContent = url.replace(/^https?:\/\//, '');
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

  function tryLocalGrab() {
    Sound.init();
    if (!S.connected) return;
    if (S.controllerCount > 0) return;      // 컨트롤러가 있으면 그쪽에서
    if (S.phase !== 'ready' && S.phase !== 'idle') return;
    net.send({ type: 'grab' });
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
  resize();
  buildPile();
  renderPrizes();
  updateUI();
  net.connect();
  requestAnimationFrame(frame);

  // 서버가 아직 목록을 안 보냈을 때를 위한 기본 표시
  setTimeout(() => { if (!S.prizes.length) renderPrizes(); }, 500);
  // 화면 갱신 (연결 상태 주기 점검)
  setInterval(() => {
    if (!S.connected) updateUI();
  }, 2000);
})();
