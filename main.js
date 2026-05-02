/* ══════════════════════════════════════
   Nyang-Suite 0.5 — main.js
══════════════════════════════════════ */

const { Engine, Render, Runner, Bodies, Composite,
        Mouse, MouseConstraint, Body, Events } = Matter;

// ── State ─────────────────────────────────
let cleanupScore    = 0;
let empathyScore    = 0;
let stressReduction = 0;
let syncProgress    = 0;
let currentStage    = 0;      // 0·1·2 — 스냅 감지용
const MAX_SYNC               = 2400;  // 자동(10pt/s×180s=75%) + 인터랙션으로 100% 조기 달성 가능
const AUTO_PROGRESS_PER_SEC  = 10;    // 가만히 있어도 차는 게이지
let isStayActive    = false;
let timerInterval   = null;
let progressInterval = null;
let timeLeft        = 180;
let blinkTimer      = null;

// Physics
let engine, render, runner, catBody;

// Items
let activeItem       = 0;      // 0=없음 1=츄르 2=뜨개실 3=레이저
let churuCount       = 0;
let laserActive      = false;
let laserMoveHandler = null;
let yarnBodies       = [];

// Pointer tracking
let pressStart     = null;
let lastPos        = null;
let lastMoveTime   = null;
let velocity       = 0;
let longPressTimer = null;
let strokeThrottle = null;

const LONG_PRESS_MS   = 600;
const FAST_THRESHOLD  = 320;
const STROKE_THROTTLE = 380;

// ── Web Audio ──────────────────────────────
let audioCtx = null;
let isMuted  = false;

const bgm    = new Audio('bgm.mp3');
bgm.loop     = true;
bgm.volume   = 0.3;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playChime() {
  if (isMuted) return;
  const ctx  = getAudioCtx();
  const now  = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  [880, 1320, 1760].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.gain.setValueAtTime(0, now + i * 0.07);
    gain.gain.linearRampToValueAtTime(0.18, now + i * 0.07 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.55);
    osc.start(now + i * 0.07);
    osc.stop(now + i * 0.07 + 0.6);
  });
}

function playCoin() {
  if (isMuted) return;
  const ctx  = getAudioCtx();
  const now  = ctx.currentTime;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'square';
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(1280, now + 0.07);
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.2);
}

function playPaperTear() {
  if (isMuted) return;
  const ctx      = getAudioCtx();
  const now      = ctx.currentTime;
  const duration = 0.55;
  const sr       = ctx.sampleRate;
  const buf      = ctx.createBuffer(1, Math.floor(sr * duration), sr);
  const data     = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t    = i / data.length;
    const env  = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    data[i] = (Math.random() * 2 - 1) * env * Math.exp(-t * 3);
  }
  const source = ctx.createBufferSource();
  source.buffer = buf;
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.value = 3800;
  bpf.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.value = 0.5;
  source.connect(bpf);
  bpf.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
}

function startBGM() {
  if (isMuted) return;
  bgm.play().catch(() => {});
}

function stopBGM() {
  bgm.pause();
  bgm.currentTime = 0;
}

function toggleMute() {
  isMuted   = !isMuted;
  bgm.muted = isMuted;
  document.getElementById('btn-mute').textContent = isMuted ? '🔇' : '🔊';
  if (!isMuted && isStayActive) bgm.play().catch(() => {});
}

// ── Scene management ──────────────────────
function showScene(id) {
  document.querySelectorAll('.scene').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Sprite swap ────────────────────────────
const SPRITE_BASE = 'img/cat_';

function setSprite(name, ms = 1200) {
  const el = document.getElementById('cat-sprite');
  if (!el) return;
  el.src = `${SPRITE_BASE}${name}.png`;
  clearTimeout(el._spriteTimer);
  el._spriteTimer = setTimeout(() => {
    el.src = `${SPRITE_BASE}idle.png`;
  }, ms);
}

// ── Blink loop ─────────────────────────────
function scheduleNextBlink() {
  blinkTimer = setTimeout(() => {
    if (!isStayActive) return;
    const el = document.getElementById('cat-sprite');
    if (!el || !el.src.includes('idle')) { scheduleNextBlink(); return; }
    el.src = `${SPRITE_BASE}blink.png`;
    setTimeout(() => {
      if (el && el.src.includes('blink')) el.src = `${SPRITE_BASE}idle.png`;
      scheduleNextBlink();
    }, 100);
  }, 2800 + Math.random() * 3500);
}

// ── Status popup (이모지) ─────────────────
function spawnPopup(icon, x, y) {
  const layer = document.getElementById('popup-layer');
  const el    = document.createElement('div');
  el.className   = 'status-popup';
  el.textContent = icon;
  el.style.left  = `${x - 18}px`;
  el.style.top   = `${y - 32}px`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// ── Interaction handlers ──────────────────
function triggerSlow(x, y) {
  cleanupScore += 5;
  empathyScore += 2;
  setSprite('slow', 1000);
  const icons = ['💖', '✨', '💖', '✨', '🌸'];
  spawnPopup(icons[Math.floor(Math.random() * icons.length)], x, y);
  playChime();
  if (navigator.vibrate) navigator.vibrate(80);
  updateProgress();
}

function triggerFast(x, y) {
  cleanupScore    += 20;
  stressReduction += 3;
  setSprite('fast', 700);
  spawnPopup('⚡', x, y);
  playCoin();
  if (navigator.vibrate) navigator.vibrate([25, 10, 25]);
  updateProgress();
}

function triggerTap(x, y) {
  cleanupScore += 1;
  setSprite('tap', 600);
  spawnPopup('✨', x, y);
  playCoin();
  if (navigator.vibrate) navigator.vibrate(12);

  if (catBody) {
    Body.applyForce(catBody, catBody.position, {
      x: (Math.random() - 0.5) * 0.06,
      y: -0.05,
    });
  }

  const container = document.getElementById('cat-container');
  container.classList.add('cat-bounce');
  setTimeout(() => container.classList.remove('cat-bounce'), 340);
  updateProgress();
}

function triggerLongPress(x, y) {
  empathyScore += 5;
  setSprite('longpress', 2200);
  spawnPopup('💖', x, y);
  setTimeout(() => spawnPopup('💖', x - 30, y - 20), 180);
  setTimeout(() => spawnPopup('💖', x + 20, y - 10), 320);
  playChime();
  if (navigator.vibrate) navigator.vibrate([65, 38, 65, 38, 65]);
  pressStart = null;
  updateProgress();
}

// ── Pointer events ────────────────────────
function onPointerDown(e) {
  if (!isStayActive) return;
  e.preventDefault();

  // 아이템 모드 분기
  if (activeItem === 1) { triggerChuru(e.clientX, e.clientY); return; }
  if (activeItem === 3) {
    // 레이저 추격 — 소량 보너스
    cleanupScore += 5;
    stressReduction += 2;
    setSprite('fast', 600);
    spawnPopup('⚡', e.clientX, e.clientY);
    updateProgress();
    return;
  }

  pressStart   = Date.now();
  lastPos      = { x: e.clientX, y: e.clientY };
  lastMoveTime = pressStart;
  velocity     = 0;

  longPressTimer = setTimeout(() => {
    triggerLongPress(e.clientX, e.clientY);
  }, LONG_PRESS_MS);
}

function onPointerMove(e) {
  if (!isStayActive || !pressStart) return;
  e.preventDefault();

  clearTimeout(longPressTimer);
  longPressTimer = null;

  const now = Date.now();
  const dx  = e.clientX - lastPos.x;
  const dy  = e.clientY - lastPos.y;
  const dt  = Math.max(now - lastMoveTime, 1);
  velocity  = Math.sqrt(dx * dx + dy * dy) / dt * 1000;

  lastPos      = { x: e.clientX, y: e.clientY };
  lastMoveTime = now;

  if (!isMuted) {
    const targetVol = 0.3 + Math.min(velocity / FAST_THRESHOLD, 1) * 0.4;
    bgm.volume += (targetVol - bgm.volume) * 0.18;
  }

  if (!strokeThrottle) {
    if (velocity > FAST_THRESHOLD) {
      triggerFast(e.clientX, e.clientY);
    } else {
      triggerSlow(e.clientX, e.clientY);
    }
    strokeThrottle = setTimeout(() => { strokeThrottle = null; }, STROKE_THROTTLE);
  }
}

function onPointerUp(e) {
  clearTimeout(longPressTimer);
  longPressTimer = null;

  if (!pressStart) return;
  const duration = Date.now() - pressStart;
  pressStart = null;

  if (duration < 220 && velocity < 90) {
    triggerTap(e.clientX, e.clientY);
  }
  if (!isMuted) bgm.volume = 0.3;
}

function initCatEvents() {
  const stage = document.getElementById('cat-stage');
  stage.addEventListener('pointerdown',   onPointerDown,  { passive: false });
  stage.addEventListener('pointermove',   onPointerMove,  { passive: false });
  stage.addEventListener('pointerup',     onPointerUp);
  stage.addEventListener('pointercancel', () => {
    clearTimeout(longPressTimer);
    pressStart = null;
  });
}

// ── Matter.js physics ─────────────────────
function initPhysics() {
  const stage = document.getElementById('cat-stage');
  const W = stage.offsetWidth;
  const H = stage.offsetHeight;

  engine = Engine.create({ gravity: { y: 0.5 } });

  render = Render.create({
    element: stage,
    engine,
    options: {
      width:      W,
      height:     H,
      wireframes: false,
      background: 'transparent',
    },
  });

  Object.assign(render.canvas.style, {
    position:      'absolute',
    inset:         '0',
    opacity:       '0.08',
    pointerEvents: 'none',
    zIndex:        '0',
  });

  catBody = Bodies.circle(W / 2, H / 2, 52, {
    restitution: 0.78,
    friction:    0.04,
    render: { fillStyle: 'rgba(201,168,76,0.55)', strokeStyle: 'transparent', lineWidth: 0 },
  });

  const wall = (x, y, w, h) =>
    Bodies.rectangle(x, y, w, h, { isStatic: true, render: { visible: false } });

  Composite.add(engine.world, [
    catBody,
    wall(W / 2, H + 25,  W + 50, 50),
    wall(W / 2, -25,     W + 50, 50),
    wall(-25,   H / 2,   50, H + 50),
    wall(W + 25, H / 2,  50, H + 50),
  ]);

  const mouse = Mouse.create(render.canvas);
  const mc    = MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.18, render: { visible: false } },
  });
  Composite.add(engine.world, mc);

  Render.run(render);
  runner = Runner.create();
  Runner.run(runner, engine);

}

// ── Stage snap transition (뾰로롱) ────────
const CAT_Y_OFFSETS = [60, 0, -40]; // px: 변기↓, 침대=, 제단↑

function triggerStageTransition(stage) {
  // 배경 바이너리 스냅 (0.25 s)
  document.getElementById('bg-1').style.opacity = stage === 0 ? 1 : 0;
  document.getElementById('bg-2').style.opacity = stage === 1 ? 1 : 0;
  document.getElementById('bg-3').style.opacity = stage === 2 ? 1 : 0;

  // 고양이 Y 쇽 점프 — spring easing
  const container = document.getElementById('cat-container');
  container.style.transition = 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)';
  container.style.transform  = `translateY(${CAT_Y_OFFSETS[stage]}px)`;
  setTimeout(() => { container.style.transition = 'transform 0.8s ease-in-out'; }, 350);

  // 진동 + 뾰로롱 음
  if (navigator.vibrate) navigator.vibrate([35, 15, 60]);
  playChime();
}

// ── Sync progress update ──────────────────
function updateProgress() {
  syncProgress = Math.min((cleanupScore + empathyScore) / MAX_SYNC, 1);

  const newStage = syncProgress < 0.33 ? 0 : syncProgress < 0.66 ? 1 : 2;
  if (newStage !== currentStage) {
    currentStage = newStage;
    triggerStageTransition(newStage);
  }

  if (syncProgress >= 1) {
    clearInterval(progressInterval);
    endStay();
  }
}

// ── Auto progress (가만히 있어도 게이지 충전) ─
function startAutoProgress() {
  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    if (!isStayActive) return;
    cleanupScore += AUTO_PROGRESS_PER_SEC;
    updateProgress();
  }, 1000);
}

// ── Item system ───────────────────────────
function selectItem(n) {
  if (activeItem === n) { deactivateItem(); return; }
  deactivateItem();
  activeItem = n;
  document.querySelectorAll('.item-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`item-${n}-btn`).classList.add('active');
  playChime();
  if (n === 1) activateChuru();
  if (n === 3) activateLaser();
}

function deactivateItem() {
  if (activeItem === 1) deactivateChuru();
  if (activeItem === 3) deactivateLaser();
  activeItem = 0;
  document.querySelectorAll('.item-btn').forEach(b => b.classList.remove('active'));
}

// ── 츄르 (item-1) ─────────────────────────
function activateChuru() {
  document.getElementById('cat-stage').style.cursor =
    `url('img/item-1.png') 8 28, pointer`;
}

function deactivateChuru() {
  document.getElementById('cat-stage').style.cursor = '';
}

function triggerChuru(x, y) {
  const sprite = document.getElementById('cat-sprite');
  if (!sprite) return;
  const rect = sprite.getBoundingClientRect();
  const catCx = rect.left + rect.width  * 0.5;
  const catCy = rect.top  + rect.height * 0.78; // 입 근처 (하단 78%)
  if (Math.hypot(x - catCx, y - catCy) > rect.width * 0.65) return;

  churuCount++;
  cleanupScore += 35;
  empathyScore += 12;
  setSprite('slow', 1600);
  spawnPopup('😋', x, y);
  updateProgress();
  playChime();
  if (navigator.vibrate) navigator.vibrate([20, 10, 20, 10, 20]);
  if (churuCount % 5 === 0) triggerChuruBonus(x, y);
}

function triggerChuruBonus(x, y) {
  cleanupScore += Math.floor(MAX_SYNC * 0.10);
  setSprite('longpress', 2600);
  [0, 160, 310].forEach(dt =>
    setTimeout(() => spawnPopup('🐾', x + (Math.random()-0.5)*56, y - 20 - Math.random()*40), dt)
  );
  spawnPopup('🌟', x, y - 70);
  updateProgress();
  if (navigator.vibrate) navigator.vibrate([30, 15, 30, 15, 60]);
}

// ── 뜨개실 (item-2) ───────────────────────
function spawnYarn() {
  if (!engine || !isStayActive) return;
  const stage = document.getElementById('cat-stage');
  const W = stage.offsetWidth;
  const x = W * 0.25 + Math.random() * W * 0.5;

  const yarn = Bodies.circle(x, -28, 18, {
    restitution: 0.84,
    friction:    0.01,
    render: { fillStyle: 'rgba(205,80,140,0.92)', strokeStyle: 'rgba(140,40,90,1)', lineWidth: 2 },
  });

  yarnBodies.push(yarn);
  Composite.add(engine.world, yarn);
  if (render) render.canvas.style.opacity = '0.72';

  setTimeout(() => {
    if (engine) Composite.remove(engine.world, yarn);
    yarnBodies.splice(yarnBodies.indexOf(yarn), 1);
    if (yarnBodies.length === 0 && render) render.canvas.style.opacity = '0.08';
  }, 6000);
}

// ── 레이저 (item-3) ───────────────────────
function activateLaser() {
  laserActive = true;
  const dot = document.getElementById('laser-dot');
  dot.style.display = 'block';

  laserMoveHandler = (e) => {
    const px = e.clientX ?? e.touches?.[0]?.clientX;
    const py = e.clientY ?? e.touches?.[0]?.clientY;
    if (px == null) return;
    dot.style.left = `${px}px`;
    dot.style.top  = `${py}px`;
    dot.classList.toggle('bloom', currentStage === 2);
    updateCatEyeTracking(px, py);
  };

  document.addEventListener('mousemove',  laserMoveHandler);
  document.addEventListener('touchmove',  laserMoveHandler, { passive: true });
}

function deactivateLaser() {
  laserActive = false;
  document.getElementById('laser-dot').style.display = 'none';
  if (laserMoveHandler) {
    document.removeEventListener('mousemove', laserMoveHandler);
    document.removeEventListener('touchmove', laserMoveHandler);
    laserMoveHandler = null;
  }
  const sprite = document.getElementById('cat-sprite');
  if (sprite) sprite.style.transform = '';
}

function updateCatEyeTracking(lx, ly) {
  const sprite = document.getElementById('cat-sprite');
  if (!sprite || !sprite.src.includes('idle')) return;
  const rect = sprite.getBoundingClientRect();
  if (!rect.width) return;
  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;
  const dx = lx - cx, dy = ly - cy;
  const dist = Math.hypot(dx, dy) || 1;
  const maxPx = 4;
  const factor = Math.min(dist / 260, 1);
  const sx = (dx / dist) * maxPx * factor;
  const sy = (dy / dist) * maxPx * factor * 0.45;
  sprite.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
}

// ── Timer ─────────────────────────────────
function fmt(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function startTimer() {
  timeLeft = 180;
  const bar   = document.getElementById('timer-bar');
  const label = document.getElementById('timer-label');
  bar.style.setProperty('--progress', '1');
  label.textContent = `🐾 ${fmt(timeLeft)}`;

  timerInterval = setInterval(() => {
    timeLeft = Math.max(0, timeLeft - 1);
    bar.style.setProperty('--progress', (timeLeft / 180).toFixed(4));
    label.textContent = `🐾 ${fmt(timeLeft)}`;
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      endStay();
    }
  }, 1000);
}

// ── Check-out / receipt ───────────────────
function buildReceipt() {
  const elapsed = 180 - timeLeft;
  document.getElementById('receipt-duration').textContent = fmt(elapsed);

  const statsEl = document.getElementById('receipt-stats');
  const rows = [
    { key: 'Clean-up', val: `+${cleanupScore.toLocaleString()}`, cls: 'positive' },
    { key: 'Empathy',  val: `+${empathyScore}`,                  cls: 'positive' },
    { key: 'Stress',   val: `-${Math.min(stressReduction + 30, 99)}%`, cls: 'negative' },
  ];
  statsEl.innerHTML = rows
    .map(r => `<div class="receipt-row">
      <span class="r-key">${r.key}</span>
      <span class="r-val ${r.cls}">${r.val}</span>
    </div>`)
    .join('');

  document.getElementById('receipt-date').textContent =
    new Date().toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
}

function endStay() {
  isStayActive = false;
  deactivateItem();
  yarnBodies.forEach(y => { if (engine) Composite.remove(engine.world, y); });
  yarnBodies = [];
  clearInterval(timerInterval);
  clearInterval(progressInterval);
  clearTimeout(blinkTimer);
  stopBGM();
  playPaperTear();
  buildReceipt();
  showScene('scene-checkout');
}

// ── Save receipt (html2canvas → PNG) ─────
function saveReceipt() {
  const el  = document.getElementById('receipt');
  const btn = document.getElementById('btn-save');
  btn.textContent = '저장 중...';
  btn.disabled    = true;

  html2canvas(el, {
    scale:           2,
    backgroundColor: '#ffffff',
    useCORS:         true,
    logging:         false,
  }).then(canvas => {
    const a      = document.createElement('a');
    a.href       = canvas.toDataURL('image/png');
    a.download   = `hwakance-receipt-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }).finally(() => {
    btn.textContent = '영수증 저장';
    btn.disabled    = false;
  });
}

// ── Entry points ──────────────────────────
document.getElementById('btn-checkin').addEventListener('click', () => {
  cleanupScore    = 0;
  empathyScore    = 0;
  stressReduction = 0;
  syncProgress    = 0;
  currentStage    = 0;

  // 배경·고양이 초기 상태 복원 (트랜지션 없이 즉시)
  const container = document.getElementById('cat-container');
  container.style.transition = 'none';
  container.style.transform  = `translateY(${CAT_Y_OFFSETS[0]}px)`;
  document.getElementById('bg-1').style.opacity = 1;
  document.getElementById('bg-2').style.opacity = 0;
  document.getElementById('bg-3').style.opacity = 0;
  requestAnimationFrame(() => { container.style.transition = 'transform 0.8s ease-in-out'; });

  showScene('scene-stay');
  isStayActive = true;
  initCatEvents();
  initPhysics();
  startTimer();
  startAutoProgress();
  scheduleNextBlink();
  startBGM();
  if (navigator.vibrate) navigator.vibrate(120);
});

document.getElementById('btn-mute').addEventListener('click', toggleMute);

document.getElementById('btn-restart').addEventListener('click', () => {
  clearTimeout(blinkTimer);
  blinkTimer = null;
  clearInterval(timerInterval);
  clearInterval(progressInterval);
  deactivateItem();
  yarnBodies.forEach(y => { if (engine) Composite.remove(engine.world, y); });
  yarnBodies  = [];
  churuCount  = 0;
  stopBGM();

  if (runner) Runner.stop(runner);
  if (render) {
    Render.stop(render);
    render.canvas.remove();
  }
  if (engine) Engine.clear(engine);

  document.getElementById('timer-bar').style.setProperty('--progress', '1');
  document.getElementById('timer-label').textContent = '🐾 03:00';

  const sprite = document.getElementById('cat-sprite');
  if (sprite) sprite.src = `${SPRITE_BASE}idle.png`;

  syncProgress    = 0;
  currentStage    = 0;
  document.getElementById('bg-1').style.opacity = 1;
  document.getElementById('bg-2').style.opacity = 0;
  document.getElementById('bg-3').style.opacity = 0;
  const container = document.getElementById('cat-container');
  container.style.transition = 'none';
  container.style.transform  = '';
  requestAnimationFrame(() => { container.style.transition = 'transform 0.8s ease-in-out'; });

  showScene('scene-checkin');
});

document.getElementById('btn-save').addEventListener('click', saveReceipt);

document.getElementById('btn-early-exit').addEventListener('click', () => {
  if (!isStayActive) return;
  endStay();
});

// ── 아이템 버튼 ────────────────────────────
document.getElementById('item-1-btn').addEventListener('click', () => { if (isStayActive) selectItem(1); });
document.getElementById('item-3-btn').addEventListener('click', () => { if (isStayActive) selectItem(3); });
document.getElementById('item-2-btn').addEventListener('click', () => {
  if (!isStayActive) return;
  // 뜨개실: 매 클릭마다 공 하나 소환 (토글 없음)
  document.getElementById('item-2-btn').classList.add('active');
  setTimeout(() => document.getElementById('item-2-btn').classList.remove('active'), 400);
  spawnYarn();
  playCoin();
});
