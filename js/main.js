/* ══════════════════════════════════════
   Nyang-Suite 0.5 — main.js
══════════════════════════════════════ */

const { Engine, Render, Runner, Bodies, Composite,
        Mouse, MouseConstraint, Body } = Matter;

// ── State ─────────────────────────────────
let cleanupScore   = 0;
let empathyScore   = 0;
let stressReduction = 0;
let isStayActive   = false;
let timerInterval  = null;
let timeLeft       = 180;

// Physics
let engine, render, runner, catBody;

// Blink
let blinkTimer = null;

// Pointer tracking
let pressStart    = null;
let lastPos       = null;
let lastMoveTime  = null;
let velocity      = 0;
let longPressTimer = null;
let strokeThrottle = null;

const LONG_PRESS_MS   = 600;
const FAST_THRESHOLD  = 320; // px/s
const STROKE_THROTTLE = 380; // ms between stroke popups

// ── Cat faces ─────────────────────────────
const FACES = {
  idle:      '( ˘ ᆺ ˘ )',
  blink:     '( - ᆺ - )',
  slow:      '( ´ ᆺ ` )',
  fast:      '( o ᆺ o ) !',
  tap:       '( ･ ᆺ･)',
  longpress: '( ♡ ᆺ ♡ )',
};

function setCatFace(key, ms = 1200) {
  const el = document.getElementById('cat-ascii-main');
  el.textContent = FACES[key] ?? FACES.idle;
  clearTimeout(el._faceTimer);
  el._faceTimer = setTimeout(() => {
    el.textContent = FACES.idle;
  }, ms);
}

// ── Blink loop ────────────────────────────
function scheduleNextBlink() {
  blinkTimer = setTimeout(() => {
    if (!isStayActive) return;
    const el = document.getElementById('cat-ascii-main');
    if (el.textContent === FACES.idle) {
      el.textContent = FACES.blink;
      setTimeout(() => {
        if (el.textContent === FACES.blink) el.textContent = FACES.idle;
        scheduleNextBlink();
      }, 110);
    } else {
      scheduleNextBlink();
    }
  }, 2800 + Math.random() * 3500);
}

// ── Scene management ──────────────────────
function showScene(id) {
  document.querySelectorAll('.scene').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Status popup ──────────────────────────
function spawnPopup(text, x, y) {
  const layer = document.getElementById('popup-layer');
  const el = document.createElement('div');
  el.className = 'status-popup';
  el.textContent = text;
  el.style.left = `${x - 55}px`;
  el.style.top  = `${y - 28}px`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1350);
}

// ── Interaction handlers ──────────────────
function triggerSlow(x, y) {
  cleanupScore += 5;
  empathyScore += 2;
  setCatFace('slow', 1000);
  spawnPopup('Luxury +5', x, y);
  if (navigator.vibrate) navigator.vibrate(80);
}

function triggerFast(x, y) {
  cleanupScore += 20;
  stressReduction += 3;
  setCatFace('fast', 750);
  spawnPopup('Energy +20', x, y);
  if (navigator.vibrate) navigator.vibrate([30, 15, 30]);
}

function triggerTap(x, y) {
  cleanupScore += 1;
  setCatFace('tap', 600);
  spawnPopup('Ping 1ms', x, y);
  if (navigator.vibrate) navigator.vibrate(14);

  // 튕기는 물리 효과 — 고양이 몸체에 임펄스
  if (catBody) {
    Body.applyForce(catBody, catBody.position, {
      x: (Math.random() - 0.5) * 0.06,
      y: -0.05,
    });
  }

  const container = document.getElementById('cat-container');
  container.classList.add('cat-bounce');
  setTimeout(() => container.classList.remove('cat-bounce'), 300);
}

function triggerLongPress(x, y) {
  empathyScore += 5;
  setCatFace('longpress', 2200);
  spawnPopup('Empathy +5', x, y);
  // 심박수 리듬 진동
  if (navigator.vibrate) navigator.vibrate([65, 38, 65, 38, 65]);
  pressStart = null; // consume so pointerup does nothing
}

// ── Pointer events ────────────────────────
function onPointerDown(e) {
  if (!isStayActive) return;
  e.preventDefault();
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

  // Tap: 짧고 거의 움직임 없음
  if (duration < 220 && velocity < 90) {
    triggerTap(e.clientX, e.clientY);
  }
}

function initCatEvents() {
  const stage = document.getElementById('cat-stage');
  stage.addEventListener('pointerdown',  onPointerDown,  { passive: false });
  stage.addEventListener('pointermove',  onPointerMove,  { passive: false });
  stage.addEventListener('pointerup',    onPointerUp);
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

  // Canvas는 ASCII 아트 뒤 반투명 레이어
  Object.assign(render.canvas.style, {
    position:      'absolute',
    inset:         '0',
    opacity:       '0.13',
    pointerEvents: 'none',
    zIndex:        '0',
  });

  catBody = Bodies.circle(W / 2, H / 2, 52, {
    restitution: 0.78,
    friction:    0.04,
    render: { fillStyle: 'rgba(201,168,76,0.7)', strokeStyle: 'transparent', lineWidth: 0 },
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

  // Matter.js 마우스는 ASCII 레이어 위 터치 이벤트와 분리
  const mouse = Mouse.create(render.canvas);
  const mc = MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.18, render: { visible: false } },
  });
  Composite.add(engine.world, mc);

  Render.run(render);
  runner = Runner.create();
  Runner.run(runner, engine);
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
  label.textContent = fmt(timeLeft);

  timerInterval = setInterval(() => {
    timeLeft = Math.max(0, timeLeft - 1);
    bar.style.setProperty('--progress', (timeLeft / 180).toFixed(4));
    label.textContent = fmt(timeLeft);
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
  buildReceipt();
  showScene('scene-checkout');
}

// ── Save receipt (html2canvas → PNG) ─────
function saveReceipt() {
  const el = document.getElementById('receipt');
  const btn = document.getElementById('btn-save');
  btn.textContent = '저장 중...';
  btn.disabled = true;

  html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  }).then(canvas => {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `hwakance-receipt-${new Date().toISOString().slice(0,10)}.png`;
    a.click();
  }).finally(() => {
    btn.textContent = '영수증 저장';
    btn.disabled = false;
  });
}

// ── Entry points ──────────────────────────
document.getElementById('btn-checkin').addEventListener('click', () => {
  cleanupScore    = 0;
  empathyScore    = 0;
  stressReduction = 0;

  showScene('scene-stay');
  isStayActive = true;
  initCatEvents();
  initPhysics();
  startTimer();
  scheduleNextBlink();
  if (navigator.vibrate) navigator.vibrate(120);
});

document.getElementById('btn-restart').addEventListener('click', () => {
  // 타이머·blink 정리
  clearTimeout(blinkTimer);
  blinkTimer = null;

  // Matter.js 정리 후 재시작
  if (runner) Runner.stop(runner);
  if (render) {
    Render.stop(render);
    render.canvas.remove();
  }
  if (engine) Engine.clear(engine);

  // 고양이 얼굴 초기화
  document.getElementById('cat-ascii-main').textContent = FACES.idle;

  // 타이머 초기화
  clearInterval(timerInterval);
  document.getElementById('timer-bar').style.setProperty('--progress', '1');
  document.getElementById('timer-label').textContent = '03:00';

  showScene('scene-checkin');
});

document.getElementById('btn-save').addEventListener('click', saveReceipt);
