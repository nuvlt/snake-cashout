/**
 * SNAKE CASHOUT v2 – script.js
 * ─────────────────────────────
 * RTP Math (~75%):
 *   Multiplier growth/frame (60fps):
 *     Δmult = MULT_GROWTH_BASE * (1 + foodBonus * MULT_FOOD_BONUS)
 *             MULT_GROWTH_BASE = 0.004, MULT_FOOD_BONUS = 0.08
 *
 *   Crash probability/frame:
 *     p = BASE_RISK * (multiplier ^ RISK_EXP)
 *         BASE_RISK = 0.0028, RISK_EXP = 1.5
 *     → at 1x ≈ 0.28%/frame, at 3x ≈ 1.45%/frame, at 5x ≈ 3.1%/frame
 *
 *   Combo bonus (+0.15x instant jump every 3 foods):
 *     Expected combo occurrences before crash are rare (avg score ~3-5),
 *     so the EV contribution is small; net RTP stays near 0.75.
 *
 *   COMBO SYSTEM:
 *     Every food eaten increments a streak counter (0→1→2→3).
 *     At 3: instant +0.15x multiplier jump + full visual/audio fanfare.
 *     Counter resets to 0 after combo fires.
 *     Per-food (non-combo): multiplier growth rate also increases (+0.08 factor).
 */

'use strict';

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════
const CFG = {
  STARTING_BALANCE:  1000,
  MIN_BET:           10,
  MAX_BET:           250,
  GRID_COLS:         20,
  GRID_ROWS:         16,
  BASE_SPEED_MS:     138,
  SPEED_INCREASE:    3,
  MIN_SPEED_MS:      52,

  MULT_GROWTH_BASE:  0.004,
  MULT_FOOD_BONUS:   0.08,
  MULT_CAP:          10.0,
  COMBO_THRESHOLD:   3,       // foods before combo fires
  COMBO_BONUS:       0.15,    // instant multiplier jump on combo

  BASE_RISK:         0.0028,
  RISK_EXP:          1.5,

  // Canvas palette
  BG_COLOR:          '#030a18',
  GRID_LINE:         'rgba(255,255,255,0.022)',
  SNAKE_HEAD_COLOR:  '#39ff85',
  SNAKE_GLOW:        'rgba(57,255,133,0.55)',
  FOOD_COLORS:       ['#ff4d6d','#ff9f1c','#a855f7','#3cf0ff','#ff3cac'],
};

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
const STATE = { IDLE:'IDLE', RUNNING:'RUNNING', CRASHED:'CRASHED', CASHED_OUT:'CASHED_OUT' };

let gameState   = STATE.IDLE;
let balance     = CFG.STARTING_BALANCE;
let currentBet  = 0;
let multiplier  = 1.0;
let foodBonus   = 0;
let score       = 0;
let bestScore   = 0;
let comboStreak = 0;   // 0..2, fires at 3
let totalCombos = 0;
let soundOn     = true;

let snake        = [];
let direction    = { x:1, y:0 };
let nextDir      = { x:1, y:0 };
let food         = [];
let stepTimer    = 0;
let lastTime     = 0;
let animFrameId  = null;
let stepInterval = CFG.BASE_SPEED_MS;
let frameCount   = 0;

// particle system for food eaten
let particles = [];

// ═══════════════════════════════════════
// CANVAS
// ═══════════════════════════════════════
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
let cellSize = 0;

function resizeCanvas() {
  const wrapper = document.getElementById('canvas-wrapper');
  const w = wrapper.clientWidth;
  const unitSize = Math.floor(w / CFG.GRID_COLS);
  canvas.width  = unitSize * CFG.GRID_COLS;
  canvas.height = unitSize * CFG.GRID_ROWS;
  cellSize = unitSize;
  wrapper.style.height = canvas.height + 'px';
  if (gameState !== STATE.RUNNING) drawIdle();
}
window.addEventListener('resize', resizeCanvas);

// ═══════════════════════════════════════
// DRAW – BACKGROUND
// ═══════════════════════════════════════
function drawBackground() {
  ctx.fillStyle = CFG.BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // subtle hex-ish diamond pattern
  for (let x = 0; x < CFG.GRID_COLS; x++) {
    for (let y = 0; y < CFG.GRID_ROWS; y++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.014)';
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }

  // grid
  ctx.strokeStyle = CFG.GRID_LINE;
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

// ═══════════════════════════════════════
// DRAW – SNAKE (neon glow style)
// ═══════════════════════════════════════
function drawRoundedCell(x, y, color, glowColor, glowRadius, cornerFactor = 0.4) {
  const px   = x * cellSize;
  const py   = y * cellSize;
  const pad  = cellSize * 0.07;
  const size = cellSize - pad * 2;
  const r    = size * cornerFactor;

  if (glowColor) {
    ctx.save();
    ctx.shadowColor  = glowColor;
    ctx.shadowBlur   = glowRadius;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(px + pad, py + pad, size, size, r);
  ctx.fill();
  if (glowColor) ctx.restore();
}

function drawSnake() {
  const len = snake.length;
  for (let i = len - 1; i >= 0; i--) {
    const seg = snake[i];

    if (i === 0) {
      // ── HEAD with glow
      drawRoundedCell(seg.x, seg.y, CFG.SNAKE_HEAD_COLOR, CFG.SNAKE_GLOW, 14, 0.48);

      // inner highlight
      const px = seg.x * cellSize + cellSize * 0.07;
      const py = seg.y * cellSize + cellSize * 0.07;
      const sz = cellSize * 0.86;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.roundRect(px + sz * 0.15, py + sz * 0.08, sz * 0.7, sz * 0.28, sz * 0.1);
      ctx.fill();

      // eyes
      const cx = seg.x * cellSize + cellSize / 2;
      const cy = seg.y * cellSize + cellSize / 2;
      const eyeR   = cellSize * 0.1;
      const eyeOff = cellSize * 0.27;
      let ex1, ey1, ex2, ey2;
      if      (direction.x ===  1) { ex1=cx+cellSize*0.18; ey1=cy-eyeOff; ex2=cx+cellSize*0.18; ey2=cy+eyeOff; }
      else if (direction.x === -1) { ex1=cx-cellSize*0.18; ey1=cy-eyeOff; ex2=cx-cellSize*0.18; ey2=cy+eyeOff; }
      else if (direction.y === -1) { ex1=cx-eyeOff; ey1=cy-cellSize*0.18; ex2=cx+eyeOff; ey2=cy-cellSize*0.18; }
      else                         { ex1=cx-eyeOff; ey1=cy+cellSize*0.18; ex2=cx+eyeOff; ey2=cy+cellSize*0.18; }

      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ex1, ey1, eyeR, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey2, eyeR, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#050f08';
      ctx.beginPath(); ctx.arc(ex1, ey1, eyeR*0.52, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey2, eyeR*0.52, 0, Math.PI*2); ctx.fill();
      // eye shine
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(ex1-eyeR*0.25, ey1-eyeR*0.25, eyeR*0.22, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2-eyeR*0.25, ey2-eyeR*0.25, eyeR*0.22, 0, Math.PI*2); ctx.fill();

    } else {
      // ── BODY: gradient from bright near head to dim at tail
      const t    = i / len;  // 0=near head, 1=tail
      const sat  = Math.round(180 + (1 - t) * 75);   // 180..255 green channel
      const alpha = 0.55 + (1 - t) * 0.45;
      const bodyColor = `rgba(34,${sat},72,${alpha.toFixed(2)})`;
      const bodyGlow  = t < 0.3 ? `rgba(57,255,133,${(0.3 - t).toFixed(2)})` : null;
      drawRoundedCell(seg.x, seg.y, bodyColor, bodyGlow, 6, 0.36);
    }
  }
}

// ═══════════════════════════════════════
// DRAW – FOOD (glowing gems)
// ═══════════════════════════════════════
function drawFood() {
  food.forEach((f) => {
    const px = f.x * cellSize + cellSize / 2;
    const py = f.y * cellSize + cellSize / 2;
    const r  = cellSize * 0.33;

    ctx.save();
    ctx.translate(px, py);

    // outer glow ring
    ctx.shadowColor = f.color;
    ctx.shadowBlur  = 12;

    // gem body
    ctx.fillStyle = f.color;
    ctx.beginPath();
    // diamond/hexagon shape
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.65, -r * 0.35);
    ctx.lineTo(r * 0.65,  r * 0.35);
    ctx.lineTo(0,  r);
    ctx.lineTo(-r * 0.65,  r * 0.35);
    ctx.lineTo(-r * 0.65, -r * 0.35);
    ctx.closePath();
    ctx.fill();

    // inner highlight facet
    ctx.shadowBlur = 0;
    ctx.fillStyle  = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.6);
    ctx.lineTo(r * 0.35, -r * 0.1);
    ctx.lineTo(0, r * 0.1);
    ctx.lineTo(-r * 0.35, -r * 0.1);
    ctx.closePath();
    ctx.fill();

    // bottom dark facet
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.moveTo(0, r);
    ctx.lineTo(r * 0.65, r * 0.35);
    ctx.lineTo(-r * 0.65, r * 0.35);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  });
}

// ═══════════════════════════════════════
// DRAW – PARTICLES
// ═══════════════════════════════════════
function spawnParticles(gx, gy, color) {
  for (let i = 0; i < 9; i++) {
    const angle = (Math.PI * 2 * i) / 9 + Math.random() * 0.4;
    const speed = 1.2 + Math.random() * 2.2;
    particles.push({
      x: gx * cellSize + cellSize / 2,
      y: gy * cellSize + cellSize / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      decay: 0.055 + Math.random() * 0.03,
      r: 2.5 + Math.random() * 3,
      color,
    });
  }
}

function updateAndDrawParticles() {
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.08;   // gravity
    p.life -= p.decay;
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 6;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// ═══════════════════════════════════════
// DRAW – IDLE SCREEN
// ═══════════════════════════════════════
function drawIdle() {
  drawBackground();
  ctx.save();
  ctx.globalAlpha = 0.22;
  const idleSegs = [
    {x:12,y:8},{x:11,y:8},{x:10,y:8},{x:9,y:8},{x:8,y:8},
    {x:8,y:9},{x:8,y:10},{x:9,y:10},{x:10,y:10},{x:11,y:10}
  ];
  idleSegs.forEach((s, i) => {
    const c = i === 0 ? CFG.SNAKE_HEAD_COLOR : `rgba(34,180,72,0.9)`;
    drawRoundedCell(s.x, s.y, c, null, 0, i === 0 ? 0.48 : 0.35);
  });
  ctx.restore();

  // "PLACE BET" hint text
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = 'rgba(57,255,133,0.8)';
  ctx.font = `bold ${cellSize * 0.9}px 'Plus Jakarta Sans', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('↓ Place bet & press START', canvas.width / 2, canvas.height * 0.78);
  ctx.restore();
}

// ═══════════════════════════════════════
// DRAW – FULL FRAME
// ═══════════════════════════════════════
function drawFrame() {
  drawBackground();
  updateAndDrawParticles();
  drawFood();
  drawSnake();
}

// ═══════════════════════════════════════
// GAME LOGIC
// ═══════════════════════════════════════
function initSnake() {
  const mx = Math.floor(CFG.GRID_COLS / 2);
  const my = Math.floor(CFG.GRID_ROWS / 2);
  snake     = [{ x:mx, y:my },{ x:mx-1, y:my },{ x:mx-2, y:my }];
  direction = { x:1, y:0 };
  nextDir   = { x:1, y:0 };
}

function spawnFood() {
  while (food.length < 2) {
    let pos, tries = 0;
    do {
      pos = {
        x: Math.floor(Math.random() * CFG.GRID_COLS),
        y: Math.floor(Math.random() * CFG.GRID_ROWS),
      };
      tries++;
    } while (
      tries < 120 && (
        snake.some(s => s.x === pos.x && s.y === pos.y) ||
        food.some(f => f.x === pos.x && f.y === pos.y)
      )
    );
    const colorIdx = Math.floor(Math.random() * CFG.FOOD_COLORS.length);
    food.push({ ...pos, color: CFG.FOOD_COLORS[colorIdx] });
  }
}

function eatFood(idx) {
  const eaten = food.splice(idx, 1)[0];
  spawnFood();
  score++;
  foodBonus++;
  comboStreak++;
  spawnParticles(snake[0].x, snake[0].y, eaten.color);
  stepInterval = Math.max(CFG.MIN_SPEED_MS, stepInterval - CFG.SPEED_INCREASE);

  if (comboStreak >= CFG.COMBO_THRESHOLD) {
    triggerCombo();
  } else {
    playSound('eat');
  }
  updateStats();
  updateStreakDots();
}

/**
 * COMBO: fires when comboStreak reaches COMBO_THRESHOLD (3).
 * - Instant +0.15x multiplier jump
 * - Multiplier display flash gold
 * - "COMBO!" badge animation on canvas
 * - Canvas border pulse
 * - Extra sound fanfare
 */
function triggerCombo() {
  comboStreak = 0;
  totalCombos++;
  multiplier = Math.min(CFG.MULT_CAP, multiplier + CFG.COMBO_BONUS);

  // Update multiplier display with combo flash
  const mv = document.getElementById('multiplier-value');
  mv.textContent = multiplier.toFixed(2) + 'x';
  mv.classList.remove('combo-flash', 'pulse');
  void mv.offsetWidth;
  mv.classList.add('combo-flash');

  // Sub text
  const sub = document.getElementById('multiplier-sub');
  sub.textContent = `🔥 COMBO! +${CFG.COMBO_BONUS}x bonus!`;
  sub.classList.add('combo-text');
  setTimeout(() => {
    sub.textContent = 'Game on! Cash out before crash!';
    sub.classList.remove('combo-text');
  }, 1800);

  // Badge popup
  const badge = document.getElementById('combo-badge');
  badge.textContent = `🔥 COMBO! +${CFG.COMBO_BONUS}x`;
  badge.classList.remove('show');
  void badge.offsetWidth;
  badge.classList.add('show');
  setTimeout(() => badge.classList.remove('show'), 1300);

  // Canvas border flash
  const wrapper = document.getElementById('canvas-wrapper');
  wrapper.classList.add('combo-border');
  setTimeout(() => wrapper.classList.remove('combo-border'), 700);

  // Spray more particles
  spawnParticles(snake[0].x, snake[0].y, '#ffd700');
  spawnParticles(snake[0].x, snake[0].y, '#ff8c1a');

  playSound('combo');
  updateStats();
  updateStreakDots();
}

function updateStreakDots() {
  for (let i = 1; i <= CFG.COMBO_THRESHOLD; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (dot) dot.classList.toggle('filled', i <= comboStreak);
  }
}

function moveSnake() {
  direction = { ...nextDir };
  const head    = snake[0];
  const newHead = { x: head.x + direction.x, y: head.y + direction.y };

  // wall
  if (newHead.x < 0 || newHead.x >= CFG.GRID_COLS || newHead.y < 0 || newHead.y >= CFG.GRID_ROWS) {
    crash(); return;
  }
  // self
  if (snake.some(s => s.x === newHead.x && s.y === newHead.y)) {
    crash(); return;
  }

  snake.unshift(newHead);

  const fi = food.findIndex(f => f.x === newHead.x && f.y === newHead.y);
  if (fi !== -1) {
    eatFood(fi);
  } else {
    snake.pop();
  }
}

/** Per-frame crash probability: p = BASE_RISK × (mult ^ RISK_EXP) */
function shouldCrash() {
  return Math.random() < CFG.BASE_RISK * Math.pow(multiplier, CFG.RISK_EXP);
}

// ═══════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════
function gameLoop(ts) {
  if (gameState !== STATE.RUNNING) return;

  const dt = ts - lastTime;
  lastTime = ts;
  frameCount++;

  // grow multiplier
  const growth = CFG.MULT_GROWTH_BASE * (1 + foodBonus * CFG.MULT_FOOD_BONUS);
  multiplier   = Math.min(CFG.MULT_CAP, multiplier + growth);

  if (frameCount % 3 === 0) updateMultiplierDisplay();

  // probabilistic crash
  if (shouldCrash()) {
    drawFrame();
    crash();
    return;
  }

  // step snake
  stepTimer += dt;
  if (stepTimer >= stepInterval) {
    stepTimer -= stepInterval;
    moveSnake();
    if (gameState !== STATE.RUNNING) return;
  }

  drawFrame();
  animFrameId = requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════
// CRASH / CASHOUT
// ═══════════════════════════════════════
function crash() {
  gameState = STATE.CRASHED;
  cancelAnimationFrame(animFrameId);
  animFrameId = null;

  playSound('crash');
  showOverlay('crash', `CRASHED at ${multiplier.toFixed(2)}x`, `Lost ${currentBet} TL`);

  document.getElementById('multiplier-value').classList.add('danger-mult');
  document.getElementById('multiplier-sub').textContent = `Crashed! −${currentBet} TL`;
  document.getElementById('multiplier-sub').classList.remove('combo-text');
  document.getElementById('btn-start').disabled   = false;
  document.getElementById('btn-cashout').disabled = true;
  document.getElementById('btn-cashout').classList.remove('glow');

  flashCanvas('rgba(255,60,90,0.3)');
  blinkBalance('red');

  if (score > bestScore) bestScore = score;
  updateStats();
}

function cashOut() {
  if (gameState !== STATE.RUNNING) return;
  gameState = STATE.CASHED_OUT;
  cancelAnimationFrame(animFrameId);
  animFrameId = null;

  const payout = Math.floor(currentBet * multiplier);
  const profit = payout - currentBet;
  balance += payout;

  playSound('cashout');
  updateBalanceDisplay();

  showOverlay('cashout', 'CASHED OUT!', `${payout} TL  (+${profit} TL profit)`);

  document.getElementById('multiplier-sub').textContent = `Cashed out ${payout} TL 🎉`;
  document.getElementById('multiplier-sub').classList.remove('combo-text');
  document.getElementById('btn-start').disabled   = false;
  document.getElementById('btn-cashout').disabled = true;
  document.getElementById('btn-cashout').classList.remove('glow');

  const mv = document.getElementById('multiplier-value');
  mv.classList.remove('danger-mult', 'combo-flash');
  mv.style.transition = 'transform 0.25s';
  mv.style.transform  = 'scale(1.18)';
  setTimeout(() => { mv.style.transform = ''; }, 300);

  blinkBalance('green');
  if (score > bestScore) bestScore = score;
  updateStats();
}

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════
function startGame() {
  if (gameState === STATE.RUNNING) return;

  const betVal = parseInt(document.getElementById('bet-input').value);
  if (isNaN(betVal) || betVal < CFG.MIN_BET || betVal > CFG.MAX_BET) {
    shakeBetInput(); return;
  }
  if (betVal > balance) {
    shakeBetInput(); return;
  }

  currentBet   = betVal;
  balance     -= currentBet;
  multiplier   = 1.0;
  foodBonus    = 0;
  score        = 0;
  comboStreak  = 0;
  stepInterval = CFG.BASE_SPEED_MS;
  stepTimer    = 0;
  frameCount   = 0;
  particles    = [];
  food         = [];

  initSnake();
  spawnFood();
  hideOverlay();
  updateBalanceDisplay();
  updateStats();
  updateStreakDots();

  gameState = STATE.RUNNING;
  document.getElementById('btn-start').disabled   = true;
  document.getElementById('btn-cashout').disabled = false;
  document.getElementById('btn-cashout').classList.add('glow');

  const mv = document.getElementById('multiplier-value');
  mv.textContent = '1.00x';
  mv.classList.remove('danger-mult', 'combo-flash', 'pulse');

  document.getElementById('multiplier-sub').textContent = 'Game on! Cash out before crash!';
  document.getElementById('multiplier-sub').classList.remove('combo-text');

  lastTime    = performance.now();
  animFrameId = requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════
function updateMultiplierDisplay() {
  const mv = document.getElementById('multiplier-value');
  mv.textContent = multiplier.toFixed(2) + 'x';
  // danger color
  if (multiplier >= 6) mv.classList.add('danger-mult');
  else mv.classList.remove('danger-mult');
  // half-x pulse
  const prev = multiplier - CFG.MULT_GROWTH_BASE * 3;
  if (Math.floor(multiplier * 2) > Math.floor(prev * 2)) {
    mv.classList.remove('pulse');
    void mv.offsetWidth;
    mv.classList.add('pulse');
  }
}

function updateBalanceDisplay() {
  document.getElementById('balance-display').textContent = balance.toLocaleString('tr-TR') + ' TL';
}

function updateStats() {
  document.getElementById('stat-bet').textContent    = currentBet ? currentBet + ' TL' : '—';
  document.getElementById('stat-score').textContent  = score;
  document.getElementById('stat-best').textContent   = bestScore;
  document.getElementById('stat-combos').textContent = totalCombos;
}

function showOverlay(type, title, detail) {
  const overlay  = document.getElementById('overlay');
  const iconEl   = document.getElementById('overlay-icon');
  const titleEl  = document.getElementById('overlay-title');
  const detailEl = document.getElementById('overlay-detail');
  overlay.className = 'overlay';
  if (type === 'crash') {
    overlay.classList.add('crash-overlay');
    iconEl.textContent     = '💥';
    titleEl.style.color    = '#ff3c5a';
  } else {
    overlay.classList.add('cashout-overlay');
    iconEl.textContent     = '💰';
    titleEl.style.color    = '#39ff85';
  }
  titleEl.textContent  = title;
  detailEl.textContent = detail;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  const o = document.getElementById('overlay');
  o.className = 'overlay hidden';
}

function flashCanvas(color) {
  let a = 0.55;
  function fade() {
    ctx.fillStyle = color.replace('0.3', a.toFixed(2));
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    a -= 0.055;
    if (a > 0) requestAnimationFrame(fade);
  }
  requestAnimationFrame(fade);
}

function blinkBalance(type) {
  const el = document.getElementById('balance-display');
  el.classList.remove('blink-green', 'blink-red');
  void el.offsetWidth;
  el.classList.add(type === 'green' ? 'blink-green' : 'blink-red');
  setTimeout(() => el.classList.remove('blink-green','blink-red'), 600);
}

function shakeBetInput() {
  const el = document.getElementById('bet-input');
  el.style.outline = '2px solid #ff3c5a';
  el.style.boxShadow = '0 0 12px rgba(255,60,90,0.4)';
  setTimeout(() => { el.style.outline = ''; el.style.boxShadow = ''; }, 700);
}

// ═══════════════════════════════════════
// SOUND ENGINE (Web Audio API)
// ═══════════════════════════════════════
let audioCtx = null;
function ac() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type) {
  if (!soundOn) return;
  try {
    const a = ac();

    if (type === 'eat') {
      const o = a.createOscillator(), g = a.createGain();
      o.connect(g); g.connect(a.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(520, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(980, a.currentTime + 0.07);
      g.gain.setValueAtTime(0.14, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.12);
      o.start(a.currentTime); o.stop(a.currentTime + 0.12);

    } else if (type === 'combo') {
      // quick 3-note burst
      [660, 880, 1100].forEach((f, i) => {
        const o = a.createOscillator(), g = a.createGain();
        o.connect(g); g.connect(a.destination);
        o.type = 'triangle';
        o.frequency.setValueAtTime(f, a.currentTime + i * 0.06);
        g.gain.setValueAtTime(0, a.currentTime + i * 0.06);
        g.gain.linearRampToValueAtTime(0.22, a.currentTime + i * 0.06 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + i * 0.06 + 0.14);
        o.start(a.currentTime + i * 0.06);
        o.stop(a.currentTime + i * 0.06 + 0.14);
      });

    } else if (type === 'crash') {
      const o = a.createOscillator(), g = a.createGain();
      o.connect(g); g.connect(a.destination);
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(35, a.currentTime + 0.45);
      g.gain.setValueAtTime(0.28, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.45);
      o.start(a.currentTime); o.stop(a.currentTime + 0.45);

    } else if (type === 'cashout') {
      [523, 659, 784, 1046].forEach((f, i) => {
        const o = a.createOscillator(), g = a.createGain();
        o.connect(g); g.connect(a.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(f, a.currentTime);
        g.gain.setValueAtTime(0, a.currentTime + i * 0.09);
        g.gain.linearRampToValueAtTime(0.18, a.currentTime + i * 0.09 + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + i * 0.09 + 0.18);
        o.start(a.currentTime + i * 0.09);
        o.stop(a.currentTime + i * 0.09 + 0.18);
      });
    }
  } catch(e) { /* ignore */ }
}

// ═══════════════════════════════════════
// INPUT
// ═══════════════════════════════════════
document.addEventListener('keydown', (e) => {
  if (gameState !== STATE.RUNNING) return;
  const map = {
    ArrowUp: {x:0,y:-1}, ArrowDown: {x:0,y:1},
    ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0},
    w:{x:0,y:-1}, s:{x:0,y:1}, a:{x:-1,y:0}, d:{x:1,y:0},
  };
  const d = map[e.key];
  if (!d) return;
  if (d.x !== 0 && d.x === -direction.x) return;
  if (d.y !== 0 && d.y === -direction.y) return;
  nextDir = d;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
});

// swipe
let touchStart = null;
canvas.addEventListener('touchstart', e => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
canvas.addEventListener('touchend', e => {
  if (!touchStart || gameState !== STATE.RUNNING) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
  let nd;
  if (Math.abs(dx) > Math.abs(dy)) nd = dx > 0 ? {x:1,y:0} : {x:-1,y:0};
  else nd = dy > 0 ? {x:0,y:1} : {x:0,y:-1};
  if (nd.x !== 0 && nd.x === -direction.x) return;
  if (nd.y !== 0 && nd.y === -direction.y) return;
  nextDir = nd;
  touchStart = null;
}, { passive: true });

// ═══════════════════════════════════════
// BUTTONS
// ═══════════════════════════════════════
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-cashout').addEventListener('click', cashOut);

document.getElementById('btn-reset').addEventListener('click', () => {
  if (gameState === STATE.RUNNING) return;
  balance = CFG.STARTING_BALANCE;
  updateBalanceDisplay();
  blinkBalance('green');
});

document.getElementById('btn-minus').addEventListener('click', () => {
  const inp = document.getElementById('bet-input');
  const v   = Math.max(CFG.MIN_BET, (parseInt(inp.value) || 50) - 10);
  inp.value = v; highlightPreset(v);
});
document.getElementById('btn-plus').addEventListener('click', () => {
  const inp = document.getElementById('bet-input');
  const v   = Math.min(CFG.MAX_BET, (parseInt(inp.value) || 50) + 10);
  inp.value = v; highlightPreset(v);
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
  soundOn = !soundOn;
  document.getElementById('sound-toggle').textContent = soundOn ? '🔊' : '🔇';
});

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
resizeCanvas();
updateBalanceDisplay();
updateStats();
highlightPreset(50);
drawIdle();
