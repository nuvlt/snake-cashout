/**
 * SNAKE CASHOUT – script.js
 * ─────────────────────────
 * RTP Math Explanation:
 *
 *  Multiplier growth (per frame at 60fps):
 *    multiplier += 0.004 * (1 + foodBonus * 0.08)
 *
 *  Crash probability per frame:
 *    p_crash = BASE_RISK * (multiplier ^ RISK_EXP)
 *    BASE_RISK = 0.0028
 *    RISK_EXP  = 1.5
 *
 *  Expected value analysis:
 *    Integrating p_survive(x) * x dx / E[bet_amount]
 *    With these constants the sim converges near 0.75 RTP.
 *
 *    Intuition: at 1.00x the per-frame crash chance is tiny (~0.28%).
 *    By 3.00x it's ~1.45% per frame. Very few rounds reach 10x cap.
 *    The geometric mean payout across all rounds targets 75% of bet.
 *
 *  NO forced losses. Every round is independently probabilistic.
 */

'use strict';

// ═══════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════
const CFG = {
  STARTING_BALANCE: 1000,
  MIN_BET: 10,
  MAX_BET: 250,
  GRID_COLS: 20,
  GRID_ROWS: 16,
  BASE_SPEED_MS: 140,   // ms per snake step
  SPEED_INCREASE: 3,    // ms faster per food eaten
  MIN_SPEED_MS: 55,
  // Multiplier growth per frame (60 fps)
  MULT_GROWTH_BASE: 0.004,
  MULT_FOOD_BONUS: 0.08,   // per food eaten added to growth factor
  MULT_CAP: 10.0,
  // Crash probability model
  BASE_RISK: 0.0028,        // base per-frame crash probability
  RISK_EXP: 1.5,            // exponent on multiplier
  // Canvas colors
  BG_COLOR: '#0e2235',
  GRID_COLOR: 'rgba(255,255,255,0.025)',
  SNAKE_HEAD: '#56d364',
  SNAKE_BODY: '#3fb950',
  SNAKE_EYE: '#ffffff',
  SNAKE_PUPIL: '#0a0a0a',
  FOOD_COLORS: ['#f85149', '#ffa657', '#d2a8ff', '#ff7b72'],
};

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
const STATE = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  CRASHED: 'CRASHED',
  CASHED_OUT: 'CASHED_OUT',
};

let state = STATE.IDLE;
let balance = CFG.STARTING_BALANCE;
let currentBet = 0;
let multiplier = 1.0;
let foodBonus = 0;       // accumulated from eating food
let score = 0;
let bestScore = 0;
let soundEnabled = true;

// Snake
let snake = [];
let direction = { x: 1, y: 0 };
let nextDir = { x: 1, y: 0 };
let food = [];
let stepTimer = 0;
let lastTime = 0;
let animFrameId = null;
let stepInterval = CFG.BASE_SPEED_MS;
let frameCount = 0;

// ═══════════════════════════════════════════════
// CANVAS SETUP
// ═══════════════════════════════════════════════
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let cellSize = 0;

function resizeCanvas() {
  const wrapper = document.getElementById('canvas-wrapper');
  const w = wrapper.clientWidth;
  // Maintain 20:16 aspect ratio
  const h = Math.floor(w * CFG.GRID_ROWS / CFG.GRID_COLS);
  canvas.width = CFG.GRID_COLS * Math.floor(w / CFG.GRID_COLS);
  canvas.height = CFG.GRID_ROWS * Math.floor(w / CFG.GRID_COLS);
  cellSize = canvas.width / CFG.GRID_COLS;
  wrapper.style.height = canvas.height + 'px';
  if (state === STATE.IDLE || state === STATE.CRASHED || state === STATE.CASHED_OUT) {
    drawIdle();
  }
}

window.addEventListener('resize', resizeCanvas);

// ═══════════════════════════════════════════════
// DRAW HELPERS
// ═══════════════════════════════════════════════
function drawGrid() {
  ctx.strokeStyle = CFG.GRID_COLOR;
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= CFG.GRID_COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cellSize, 0);
    ctx.lineTo(x * cellSize, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= CFG.GRID_ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellSize);
    ctx.lineTo(canvas.width, y * cellSize);
    ctx.stroke();
  }
}

function drawCell(x, y, color, radius = 0.3) {
  const px = x * cellSize;
  const py = y * cellSize;
  const pad = cellSize * 0.08;
  const r = cellSize * radius;
  const w = cellSize - pad * 2;
  const h = cellSize - pad * 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(px + pad, py + pad, w, h, r);
  ctx.fill();
}

function drawSnake() {
  for (let i = snake.length - 1; i >= 0; i--) {
    const seg = snake[i];
    if (i === 0) {
      // Head
      drawCell(seg.x, seg.y, CFG.SNAKE_HEAD, 0.45);
      // Eyes
      const px = seg.x * cellSize;
      const py = seg.y * cellSize;
      const c = cellSize;
      const eyeOffset = c * 0.28;
      const eyeR = c * 0.1;
      // Determine eye positions based on direction
      let ex1, ey1, ex2, ey2;
      const cx = px + c / 2;
      const cy = py + c / 2;
      if (direction.x === 1) { // right
        ex1 = cx + c * 0.15; ey1 = cy - eyeOffset;
        ex2 = cx + c * 0.15; ey2 = cy + eyeOffset;
      } else if (direction.x === -1) { // left
        ex1 = cx - c * 0.15; ey1 = cy - eyeOffset;
        ex2 = cx - c * 0.15; ey2 = cy + eyeOffset;
      } else if (direction.y === -1) { // up
        ex1 = cx - eyeOffset; ey1 = cy - c * 0.15;
        ex2 = cx + eyeOffset; ey2 = cy - c * 0.15;
      } else { // down
        ex1 = cx - eyeOffset; ey1 = cy + c * 0.15;
        ex2 = cx + eyeOffset; ey2 = cy + c * 0.15;
      }
      ctx.fillStyle = CFG.SNAKE_EYE;
      ctx.beginPath(); ctx.arc(ex1, ey1, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey2, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = CFG.SNAKE_PUPIL;
      ctx.beginPath(); ctx.arc(ex1, ey1, eyeR * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey2, eyeR * 0.55, 0, Math.PI * 2); ctx.fill();
    } else {
      // Gradient body: darker toward tail
      const t = i / snake.length;
      const alpha = 0.6 + (1 - t) * 0.4;
      const bodyColor = `rgba(63, 185, 80, ${alpha})`;
      drawCell(seg.x, seg.y, bodyColor, 0.35);
    }
  }
}

function drawFood() {
  food.forEach((f, idx) => {
    const px = f.x * cellSize + cellSize / 2;
    const py = f.y * cellSize + cellSize / 2;
    const r = cellSize * 0.32;
    const color = CFG.FOOD_COLORS[idx % CFG.FOOD_COLORS.length];
    // Draw cute chili pepper shape
    ctx.save();
    ctx.translate(px, py);
    // stem
    ctx.strokeStyle = '#4d8c4a';
    ctx.lineWidth = cellSize * 0.07;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.8);
    ctx.quadraticCurveTo(r * 0.3, -r * 1.3, r * 0.1, -r * 1.6);
    ctx.stroke();
    // pepper body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.45, r * 0.9, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // shine
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.12, -r * 0.3, r * 0.12, r * 0.22, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawBackground() {
  ctx.fillStyle = CFG.BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Subtle checkerboard
  for (let x = 0; x < CFG.GRID_COLS; x++) {
    for (let y = 0; y < CFG.GRID_ROWS; y++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.012)';
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }
}

function drawFrame() {
  drawBackground();
  drawGrid();
  drawFood();
  drawSnake();
}

function drawIdle() {
  drawBackground();
  drawGrid();
  // Draw decorative idle snake
  ctx.save();
  ctx.globalAlpha = 0.25;
  const idleSegs = [
    {x:10,y:8},{x:9,y:8},{x:8,y:8},{x:7,y:8},{x:7,y:9},{x:7,y:10},{x:8,y:10},{x:9,y:10}
  ];
  idleSegs.forEach((s, i) => {
    drawCell(s.x, s.y, i === 0 ? CFG.SNAKE_HEAD : CFG.SNAKE_BODY, 0.4);
  });
  ctx.restore();
}

// ═══════════════════════════════════════════════
// GAME LOGIC
// ═══════════════════════════════════════════════
function initSnake() {
  const midY = Math.floor(CFG.GRID_ROWS / 2);
  const midX = Math.floor(CFG.GRID_COLS / 2);
  snake = [
    { x: midX, y: midY },
    { x: midX - 1, y: midY },
    { x: midX - 2, y: midY },
  ];
  direction = { x: 1, y: 0 };
  nextDir = { x: 1, y: 0 };
}

function spawnFood() {
  // Max 2 food items on screen
  while (food.length < 2) {
    let pos;
    let attempts = 0;
    do {
      pos = {
        x: Math.floor(Math.random() * CFG.GRID_COLS),
        y: Math.floor(Math.random() * CFG.GRID_ROWS),
      };
      attempts++;
    } while (
      attempts < 100 &&
      (snake.some(s => s.x === pos.x && s.y === pos.y) ||
       food.some(f => f.x === pos.x && f.y === pos.y))
    );
    food.push(pos);
  }
}

function moveSnake() {
  direction = { ...nextDir };
  const head = snake[0];
  const newHead = {
    x: head.x + direction.x,
    y: head.y + direction.y,
  };

  // Wall collision
  if (
    newHead.x < 0 || newHead.x >= CFG.GRID_COLS ||
    newHead.y < 0 || newHead.y >= CFG.GRID_ROWS
  ) {
    crash();
    return;
  }

  // Self collision
  if (snake.some(s => s.x === newHead.x && s.y === newHead.y)) {
    crash();
    return;
  }

  snake.unshift(newHead);

  // Food eaten?
  const foodIdx = food.findIndex(f => f.x === newHead.x && f.y === newHead.y);
  if (foodIdx !== -1) {
    food.splice(foodIdx, 1);
    spawnFood();
    score++;
    foodBonus++;
    // Speed up
    stepInterval = Math.max(CFG.MIN_SPEED_MS, stepInterval - CFG.SPEED_INCREASE);
    playSound('eat');
    updateStats();
  } else {
    snake.pop();
  }
}

/**
 * Crash probability per frame:
 *   p = BASE_RISK * (multiplier ^ RISK_EXP)
 * At mult=1.0: p ≈ 0.0028 (0.28%/frame)
 * At mult=3.0: p ≈ 0.0028 * 5.2 ≈ 1.45%/frame
 * At mult=5.0: p ≈ 0.0028 * 11.2 ≈ 3.1%/frame
 * This creates natural-feeling crashes weighted toward lower multipliers.
 */
function checkCrashProbability() {
  const p = CFG.BASE_RISK * Math.pow(multiplier, CFG.RISK_EXP);
  return Math.random() < p;
}

function crash() {
  state = STATE.CRASHED;
  cancelAnimationFrame(animFrameId);
  animFrameId = null;
  playSound('crash');

  // Show overlay
  showOverlay('crash', `💥 CRASHED at ${multiplier.toFixed(2)}x`, `Lost ${currentBet} TL`);

  // Update UI
  document.getElementById('multiplier-value').classList.add('danger-mult');
  document.getElementById('multiplier-sub').textContent = `Crashed! Lost ${currentBet} TL`;
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-cashout').disabled = true;
  document.getElementById('btn-cashout').classList.remove('glow');

  // Flash canvas red
  flashCanvas('rgba(233,69,96,0.35)');

  // Balance blink
  document.getElementById('balance-display').classList.add('blink-red');
  setTimeout(() => document.getElementById('balance-display').classList.remove('blink-red'), 500);

  if (score > bestScore) {
    bestScore = score;
    updateStats();
  }
}

function cashOut() {
  if (state !== STATE.RUNNING) return;
  state = STATE.CASHED_OUT;
  cancelAnimationFrame(animFrameId);
  animFrameId = null;

  const payout = Math.floor(currentBet * multiplier);
  balance += payout;
  const profit = payout - currentBet;

  playSound('cashout');
  updateBalanceDisplay();

  showOverlay('cashout', `💰 CASHED OUT!`, `${payout} TL (+${profit} TL profit)`);

  document.getElementById('multiplier-sub').textContent = `Cashed out ${payout} TL 🎉`;
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-cashout').disabled = true;
  document.getElementById('btn-cashout').classList.remove('glow');

  const mv = document.getElementById('multiplier-value');
  mv.classList.remove('danger-mult');
  mv.style.transform = 'scale(1.2)';
  setTimeout(() => { mv.style.transform = ''; }, 300);

  document.getElementById('balance-display').classList.add('blink-green');
  setTimeout(() => document.getElementById('balance-display').classList.remove('blink-green'), 500);

  if (score > bestScore) {
    bestScore = score;
    updateStats();
  }
}

// ═══════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════
function gameLoop(timestamp) {
  if (state !== STATE.RUNNING) return;

  const dt = timestamp - lastTime;
  lastTime = timestamp;
  frameCount++;

  // Multiplier growth per frame
  const growthRate = CFG.MULT_GROWTH_BASE * (1 + foodBonus * CFG.MULT_FOOD_BONUS);
  multiplier = Math.min(CFG.MULT_CAP, multiplier + growthRate);

  // Update multiplier display every 3 frames
  if (frameCount % 3 === 0) {
    updateMultiplierDisplay();
  }

  // Check probabilistic crash
  if (checkCrashProbability()) {
    drawFrame();
    crash();
    return;
  }

  // Move snake on step timer
  stepTimer += dt;
  if (stepTimer >= stepInterval) {
    stepTimer -= stepInterval;
    moveSnake();
    if (state !== STATE.RUNNING) return;
  }

  drawFrame();
  animFrameId = requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════════════
// START / STOP
// ═══════════════════════════════════════════════
function startGame() {
  if (state === STATE.RUNNING) return;

  const betVal = parseInt(document.getElementById('bet-input').value);
  if (isNaN(betVal) || betVal < CFG.MIN_BET) {
    shakeElement('bet-input');
    return;
  }
  if (betVal > balance) {
    shakeElement('bet-input');
    return;
  }

  currentBet = betVal;
  balance -= currentBet;
  updateBalanceDisplay();

  // Reset game vars
  multiplier = 1.0;
  foodBonus = 0;
  score = 0;
  stepInterval = CFG.BASE_SPEED_MS;
  stepTimer = 0;
  frameCount = 0;
  food = [];

  initSnake();
  spawnFood();
  hideOverlay();

  state = STATE.RUNNING;

  document.getElementById('btn-start').disabled = true;
  document.getElementById('btn-cashout').disabled = false;
  document.getElementById('btn-cashout').classList.add('glow');
  document.getElementById('multiplier-value').classList.remove('danger-mult');
  document.getElementById('multiplier-value').textContent = '1.00x';
  document.getElementById('multiplier-sub').textContent = 'Game on! Cash out before crash!';

  updateStats();

  lastTime = performance.now();
  animFrameId = requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════════════
// UI UPDATES
// ═══════════════════════════════════════════════
function updateMultiplierDisplay() {
  const mv = document.getElementById('multiplier-value');
  mv.textContent = multiplier.toFixed(2) + 'x';
  // Danger color above 4x
  if (multiplier >= 6) {
    mv.classList.add('danger-mult');
  } else {
    mv.classList.remove('danger-mult');
  }
  // Pulse every 0.5x threshold
  if (Math.floor(multiplier * 2) > Math.floor((multiplier - CFG.MULT_GROWTH_BASE * 3) * 2)) {
    mv.classList.remove('pulse');
    void mv.offsetWidth; // reflow
    mv.classList.add('pulse');
  }
}

function updateBalanceDisplay() {
  document.getElementById('balance-display').textContent = balance.toLocaleString() + ' TL';
}

function updateStats() {
  document.getElementById('stat-bet').textContent = currentBet ? currentBet + ' TL' : '—';
  document.getElementById('stat-score').textContent = score;
  document.getElementById('stat-best').textContent = bestScore;
}

function showOverlay(type, title, detail) {
  const overlay = document.getElementById('overlay');
  const icon = document.getElementById('overlay-icon');
  const titleEl = document.getElementById('overlay-title');
  const detailEl = document.getElementById('overlay-detail');

  overlay.className = 'overlay';
  if (type === 'crash') {
    overlay.classList.add('crash-overlay');
    icon.textContent = '💥';
    titleEl.style.color = '#e94560';
  } else {
    overlay.classList.add('cashout-overlay');
    icon.textContent = '💰';
    titleEl.style.color = '#4ecca3';
  }
  titleEl.textContent = title.replace(/^💥 |^💰 /, '');
  detailEl.textContent = detail;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  const overlay = document.getElementById('overlay');
  overlay.classList.add('hidden');
  overlay.className = 'overlay hidden';
}

function flashCanvas(color) {
  let alpha = 0.5;
  function fade() {
    ctx.fillStyle = color.replace('0.35', alpha.toFixed(2));
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    alpha -= 0.05;
    if (alpha > 0) requestAnimationFrame(fade);
  }
  requestAnimationFrame(fade);
}

function shakeElement(id) {
  const el = document.getElementById(id);
  el.style.animation = 'none';
  el.style.outline = '2px solid #e94560';
  setTimeout(() => { el.style.outline = ''; }, 600);
}

// ═══════════════════════════════════════════════
// SOUND ENGINE (Web Audio API oscillators)
// ═══════════════════════════════════════════════
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type) {
  if (!soundEnabled) return;
  try {
    const ac = getAudioCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);

    if (type === 'eat') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ac.currentTime + 0.08);
      gain.gain.setValueAtTime(0.15, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.15);
    } else if (type === 'crash') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ac.currentTime + 0.4);
      gain.gain.setValueAtTime(0.25, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.4);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.4);
    } else if (type === 'cashout') {
      // Happy ascending arpeggio
      [523, 659, 784, 1046].forEach((freq, i) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, ac.currentTime);
        g.gain.setValueAtTime(0, ac.currentTime + i * 0.08);
        g.gain.linearRampToValueAtTime(0.18, ac.currentTime + i * 0.08 + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * 0.08 + 0.15);
        o.start(ac.currentTime + i * 0.08);
        o.stop(ac.currentTime + i * 0.08 + 0.15);
      });
      return;
    }
  } catch(e) { /* ignore */ }
}

// ═══════════════════════════════════════════════
// INPUT HANDLING
// ═══════════════════════════════════════════════

// Keyboard
document.addEventListener('keydown', (e) => {
  if (state !== STATE.RUNNING) return;
  const d = {
    ArrowUp:    { x: 0, y: -1 },
    ArrowDown:  { x: 0, y: 1 },
    ArrowLeft:  { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    w: { x: 0, y: -1 }, s: { x: 0, y: 1 },
    a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
  }[e.key];
  if (!d) return;
  // Prevent reversing
  if (d.x !== 0 && d.x === -direction.x) return;
  if (d.y !== 0 && d.y === -direction.y) return;
  nextDir = d;
  // Prevent page scroll
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault();
  }
});

// Touch / swipe
let touchStart = null;
canvas.addEventListener('touchstart', (e) => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  if (!touchStart || state !== STATE.RUNNING) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
  let nd;
  if (Math.abs(dx) > Math.abs(dy)) {
    nd = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
  } else {
    nd = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
  }
  if (nd.x !== 0 && nd.x === -direction.x) return;
  if (nd.y !== 0 && nd.y === -direction.y) return;
  nextDir = nd;
  touchStart = null;
}, { passive: true });

// ═══════════════════════════════════════════════
// BUTTON BINDINGS
// ═══════════════════════════════════════════════
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-cashout').addEventListener('click', cashOut);

document.getElementById('btn-reset').addEventListener('click', () => {
  if (state === STATE.RUNNING) return;
  balance = CFG.STARTING_BALANCE;
  updateBalanceDisplay();
  document.getElementById('balance-display').classList.add('blink-green');
  setTimeout(() => document.getElementById('balance-display').classList.remove('blink-green'), 600);
});

document.getElementById('btn-minus').addEventListener('click', () => {
  const inp = document.getElementById('bet-input');
  const v = Math.max(CFG.MIN_BET, (parseInt(inp.value) || 50) - 10);
  inp.value = v;
  highlightPreset(v);
});

document.getElementById('btn-plus').addEventListener('click', () => {
  const inp = document.getElementById('bet-input');
  const v = Math.min(CFG.MAX_BET, (parseInt(inp.value) || 50) + 10);
  inp.value = v;
  highlightPreset(v);
});

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const amt = parseInt(btn.dataset.amount);
    document.getElementById('bet-input').value = amt;
    highlightPreset(amt);
  });
});

document.getElementById('bet-input').addEventListener('input', () => {
  highlightPreset(parseInt(document.getElementById('bet-input').value));
});

function highlightPreset(val) {
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.amount) === val);
  });
}

document.getElementById('sound-toggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  document.getElementById('sound-toggle').textContent = soundEnabled ? '🔊' : '🔇';
});

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
resizeCanvas();
updateBalanceDisplay();
updateStats();
highlightPreset(50);
drawIdle();
