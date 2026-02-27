/**
 * SNAKE CASHOUT v3 – 80s Arcade Edition
 * ─────────────────────────────────────
 * RTP Math (~75%):
 *   Multiplier growth per frame (60fps):
 *     Δmult = 0.004 * (1 + foodBonus * 0.08)
 *
 *   Crash probability per frame:
 *     p = 0.0026 * (multiplier ^ 1.5)
 *     (BASE_RISK slightly reduced vs vanilla to offset spike EV)
 *
 *   SPIKE MECHANIC:
 *     Every food eaten → instant +0.10x multiplier jump.
 *     Visual: magenta badge popup + pixel explosion + multiplier flash.
 *     Audio: 8-bit two-tone blip.
 */

'use strict';

const CFG = {
  STARTING_BALANCE: 1000,
  MIN_BET:          10,
  MAX_BET:          250,
  GRID_COLS:        20,
  GRID_ROWS:        16,
  BASE_SPEED_MS:    145,
  SPEED_INCREASE:   4,
  MIN_SPEED_MS:     58,
  MULT_GROWTH_BASE: 0.004,
  MULT_FOOD_BONUS:  0.08,
  MULT_CAP:         10.0,
  SPIKE_AMOUNT:     0.10,
  BASE_RISK:        0.0026,
  RISK_EXP:         1.5,
  BG_COLOR:         '#050508',
  GRID_COLOR:       'rgba(0,240,255,0.06)',
  SNAKE_COLOR:      '#00ff41',
  FOOD_COLORS:      ['#ff2244','#ffe600','#ff00cc','#00f0ff','#ff6e00'],
};

const S = { IDLE:'IDLE', RUNNING:'RUNNING', CRASHED:'CRASHED', CASHED_OUT:'CASHED_OUT' };
let gameState   = S.IDLE;
let balance     = CFG.STARTING_BALANCE;
let currentBet  = 0;
let multiplier  = 1.0;
let foodBonus   = 0;
let score       = 0;
let bestScore   = 0;
let totalSpikes = 0;
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
let pixels       = [];

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
let cellSize = 0;

// ── RESIZE ──────────────────────────────
function resizeCanvas() {
  const wrapper = document.getElementById('canvas-wrapper');
  const w    = wrapper.clientWidth;
  const unit = Math.floor(w / CFG.GRID_COLS);
  canvas.width  = unit * CFG.GRID_COLS;
  canvas.height = unit * CFG.GRID_ROWS;
  cellSize = unit;
  wrapper.style.height = canvas.height + 'px';
  if (gameState !== S.RUNNING) drawIdle();
}
window.addEventListener('resize', resizeCanvas);

// ── DRAW BACKGROUND ──────────────────────
function drawBackground() {
  ctx.fillStyle = CFG.BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = CFG.GRID_COLOR;
  for (let x = 0; x <= CFG.GRID_COLS; x++)
    for (let y = 0; y <= CFG.GRID_ROWS; y++)
      ctx.fillRect(x * cellSize - 0.5, y * cellSize - 0.5, 1.5, 1.5);
  ctx.strokeStyle = 'rgba(255,230,0,0.07)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
}

// ── DRAW PIXEL CELL ──────────────────────
function drawPixelCell(x, y, color, bevel = true) {
  const px = x * cellSize, py = y * cellSize;
  const pad = 1, sz = cellSize - pad * 2;
  ctx.fillStyle = color;
  ctx.fillRect(px + pad, py + pad, sz, sz);
  if (bevel) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(px + pad, py + pad, sz, 2);
    ctx.fillRect(px + pad, py + pad, 2, sz);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px + pad, py + pad + sz - 2, sz, 2);
    ctx.fillRect(px + pad + sz - 2, py + pad, 2, sz);
  }
}

// ── DRAW SNAKE ───────────────────────────
function drawSnake() {
  for (let i = snake.length - 1; i >= 0; i--) {
    const seg = snake[i];
    if (i === 0) {
      drawPixelCell(seg.x, seg.y, CFG.SNAKE_COLOR, true);
      // highlight stripe on head
      const px = seg.x * cellSize, py = seg.y * cellSize;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(px + 2, py + 2, cellSize - 4, Math.floor(cellSize * 0.3));
      // eyes
      const mid    = cellSize / 2;
      const eSize  = Math.max(2, Math.floor(cellSize * 0.14));
      const eOff   = Math.floor(cellSize * 0.24);
      ctx.fillStyle = '#fff';
      if      (direction.x ===  1) { ctx.fillRect(px+mid+eOff*0.4, py+mid-eOff, eSize, eSize); ctx.fillRect(px+mid+eOff*0.4, py+mid+eOff-eSize, eSize, eSize); }
      else if (direction.x === -1) { ctx.fillRect(px+mid-eOff*0.4-eSize, py+mid-eOff, eSize, eSize); ctx.fillRect(px+mid-eOff*0.4-eSize, py+mid+eOff-eSize, eSize, eSize); }
      else if (direction.y === -1) { ctx.fillRect(px+mid-eOff, py+mid-eOff*0.4-eSize, eSize, eSize); ctx.fillRect(px+mid+eOff-eSize, py+mid-eOff*0.4-eSize, eSize, eSize); }
      else                         { ctx.fillRect(px+mid-eOff, py+mid+eOff*0.4, eSize, eSize); ctx.fillRect(px+mid+eOff-eSize, py+mid+eOff*0.4, eSize, eSize); }
    } else {
      const t = i / snake.length;
      const g = Math.round(255 * (1 - t * 0.65));
      drawPixelCell(seg.x, seg.y, `rgb(0,${g},${Math.round(g*0.22)})`, i < 3);
    }
  }
}

// ── DRAW FOOD ────────────────────────────
function drawFood() {
  food.forEach(f => {
    const px  = f.x * cellSize, py = f.y * cellSize;
    const mid = cellSize / 2;
    const r   = Math.floor(cellSize * 0.3);
    const blink = (frameCount + f.blinkOffset) % 40 < 28;
    ctx.globalAlpha = blink ? 1.0 : 0.5;
    ctx.fillStyle = f.color;
    // diamond shape made of pixel rects
    ctx.fillRect(px + mid - 1,     py + mid - r,     2, r * 2);
    ctx.fillRect(px + mid - r,     py + mid - 1,     r * 2, 2);
    ctx.fillRect(px + mid - r + 2, py + mid - r + 2, r - 2, r - 2);
    ctx.fillRect(px + mid + 1,     py + mid - r + 2, r - 2, r - 2);
    ctx.fillRect(px + mid - r + 2, py + mid + 1,     r - 2, r - 2);
    ctx.fillRect(px + mid + 1,     py + mid + 1,     r - 2, r - 2);
    if (blink) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(px + mid - 1, py + mid - r + 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  });
}

// ── PIXEL EXPLOSION ──────────────────────
function spawnPixelExplosion(gx, gy, color) {
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.5;
    const speed = 1.5 + Math.random() * 3;
    pixels.push({
      x: gx * cellSize + cellSize / 2,
      y: gy * cellSize + cellSize / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      decay: 0.05 + Math.random() * 0.04,
      size: Math.max(2, Math.floor(cellSize * 0.13)),
      color,
    });
  }
}

function updatePixels() {
  pixels = pixels.filter(p => p.life > 0);
  pixels.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life -= p.decay;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    const s = Math.ceil(p.size * p.life);
    ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
  });
  ctx.globalAlpha = 1;
}

// ── DRAW IDLE ────────────────────────────
let idleTimer = null;
function drawIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  drawBackground();
  const segs = [{x:12,y:8},{x:11,y:8},{x:10,y:8},{x:9,y:8},{x:8,y:8},{x:8,y:9},{x:8,y:10},{x:9,y:10},{x:10,y:10}];
  ctx.globalAlpha = 0.28;
  segs.forEach((seg, i) => {
    const g = i === 0 ? 255 : Math.round(255 * (1 - i / segs.length * 0.7));
    drawPixelCell(seg.x, seg.y, i === 0 ? CFG.SNAKE_COLOR : `rgb(0,${g},${Math.round(g*0.22)})`, false);
  });
  ctx.globalAlpha = 1;
  if (Math.floor(Date.now() / 600) % 2 === 0) {
    ctx.fillStyle = '#ffe600';
    ctx.font = `${Math.max(6, Math.floor(cellSize * 0.5))}px 'Press Start 2P', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('INSERT COIN', canvas.width / 2, canvas.height * 0.75);
  }
  if (gameState === S.IDLE || gameState === S.CRASHED || gameState === S.CASHED_OUT) {
    idleTimer = setTimeout(drawIdle, 600);
  }
}

// ── FULL FRAME ───────────────────────────
function drawFrame() {
  drawBackground();
  updatePixels();
  drawFood();
  drawSnake();
}

// ── SNAKE INIT ───────────────────────────
function initSnake() {
  const mx = Math.floor(CFG.GRID_COLS / 2), my = Math.floor(CFG.GRID_ROWS / 2);
  snake = [{x:mx,y:my},{x:mx-1,y:my},{x:mx-2,y:my}];
  direction = {x:1,y:0}; nextDir = {x:1,y:0};
}

function spawnFood() {
  while (food.length < 2) {
    let pos, tries = 0;
    do {
      pos = { x: Math.floor(Math.random() * CFG.GRID_COLS), y: Math.floor(Math.random() * CFG.GRID_ROWS) };
      tries++;
    } while (tries < 120 && (snake.some(s => s.x === pos.x && s.y === pos.y) || food.some(f => f.x === pos.x && f.y === pos.y)));
    const ci = Math.floor(Math.random() * CFG.FOOD_COLORS.length);
    food.push({ ...pos, color: CFG.FOOD_COLORS[ci], blinkOffset: Math.floor(Math.random() * 40) });
  }
}

// ── EAT + SPIKE ──────────────────────────
function eatFood(idx) {
  const eaten = food.splice(idx, 1)[0];
  spawnFood();
  score++; foodBonus++; totalSpikes++;
  stepInterval = Math.max(CFG.MIN_SPEED_MS, stepInterval - CFG.SPEED_INCREASE);

  // SPIKE: instant multiplier jump
  multiplier = Math.min(CFG.MULT_CAP, multiplier + CFG.SPIKE_AMOUNT);

  // Visual feedback
  spawnPixelExplosion(snake[0].x, snake[0].y, eaten.color);
  spawnPixelExplosion(snake[0].x, snake[0].y, '#ff00cc');

  const mv = document.getElementById('multiplier-value');
  mv.textContent = multiplier.toFixed(2) + 'x';
  mv.classList.remove('spike-flash', 'pulse');
  void mv.offsetWidth;
  mv.classList.add('spike-flash');

  const badge = document.getElementById('spike-badge');
  badge.textContent = `+${CFG.SPIKE_AMOUNT.toFixed(2)}x SPIKE!`;
  badge.classList.remove('show');
  void badge.offsetWidth;
  badge.classList.add('show');
  setTimeout(() => badge.classList.remove('show'), 1000);

  const sub = document.getElementById('multiplier-sub');
  sub.textContent = `SPIKE! +${CFG.SPIKE_AMOUNT.toFixed(2)}x`;
  sub.classList.add('spike-text');
  setTimeout(() => { if (gameState === S.RUNNING) { sub.textContent = 'CASH OUT BEFORE CRASH!'; sub.classList.remove('spike-text'); } }, 900);

  playSound('spike');
  updateStats();
}

// ── MOVE ─────────────────────────────────
function moveSnake() {
  direction = { ...nextDir };
  const newHead = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
  if (newHead.x < 0 || newHead.x >= CFG.GRID_COLS || newHead.y < 0 || newHead.y >= CFG.GRID_ROWS) { crash(); return; }
  if (snake.some(s => s.x === newHead.x && s.y === newHead.y)) { crash(); return; }
  snake.unshift(newHead);
  const fi = food.findIndex(f => f.x === newHead.x && f.y === newHead.y);
  if (fi !== -1) eatFood(fi); else snake.pop();
}

function shouldCrash() {
  return Math.random() < CFG.BASE_RISK * Math.pow(multiplier, CFG.RISK_EXP);
}

// ── GAME LOOP ────────────────────────────
function gameLoop(ts) {
  if (gameState !== S.RUNNING) return;
  const dt = ts - lastTime; lastTime = ts; frameCount++;
  multiplier = Math.min(CFG.MULT_CAP, multiplier + CFG.MULT_GROWTH_BASE * (1 + foodBonus * CFG.MULT_FOOD_BONUS));
  if (frameCount % 3 === 0) updateMultiplierDisplay();
  if (shouldCrash()) { drawFrame(); crash(); return; }
  stepTimer += dt;
  if (stepTimer >= stepInterval) { stepTimer -= stepInterval; moveSnake(); if (gameState !== S.RUNNING) return; }
  drawFrame();
  animFrameId = requestAnimationFrame(gameLoop);
}

// ── CRASH / CASHOUT ──────────────────────
function crash() {
  gameState = S.CRASHED;
  cancelAnimationFrame(animFrameId); animFrameId = null;
  playSound('crash');
  flashScreen('rgba(255,34,68,0.45)');
  showOverlay('crash', 'GAME OVER', `CRASHED @ ${multiplier.toFixed(2)}x\nLOST ${currentBet} TL`);
  document.getElementById('multiplier-value').classList.add('danger-mult');
  document.getElementById('multiplier-sub').textContent = 'PRESS START TO TRY AGAIN';
  document.getElementById('multiplier-sub').classList.remove('spike-text');
  document.getElementById('btn-start').disabled   = false;
  document.getElementById('btn-cashout').disabled = true;
  document.getElementById('btn-cashout').classList.remove('glow');
  blinkBalance('red');
  if (score > bestScore) bestScore = score;
  updateStats();
  drawIdle();
}

function cashOut() {
  if (gameState !== S.RUNNING) return;
  gameState = S.CASHED_OUT;
  cancelAnimationFrame(animFrameId); animFrameId = null;
  const payout = Math.floor(currentBet * multiplier);
  const profit = payout - currentBet;
  balance += payout;
  playSound('cashout');
  updateBalanceDisplay();
  flashScreen('rgba(0,255,65,0.22)');
  showOverlay('cashout', 'WINNER!', `PAYOUT: ${payout} TL\nPROFIT: +${profit} TL`);
  document.getElementById('multiplier-sub').textContent = `CASHED OUT! +${profit} TL`;
  document.getElementById('multiplier-sub').classList.remove('spike-text');
  document.getElementById('btn-start').disabled   = false;
  document.getElementById('btn-cashout').disabled = true;
  document.getElementById('btn-cashout').classList.remove('glow');
  blinkBalance('green');
  if (score > bestScore) bestScore = score;
  updateStats();
  drawIdle();
}

// ── START ────────────────────────────────
function startGame() {
  if (gameState === S.RUNNING) return;
  const betVal = parseInt(document.getElementById('bet-input').value);
  if (isNaN(betVal) || betVal < CFG.MIN_BET || betVal > CFG.MAX_BET || betVal > balance) { shakeBetInput(); return; }

  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  currentBet   = betVal;
  balance     -= currentBet;
  multiplier   = 1.0; foodBonus = 0; score = 0;
  stepInterval = CFG.BASE_SPEED_MS; stepTimer = 0; frameCount = 0;
  pixels = []; food = [];

  initSnake(); spawnFood(); hideOverlay();
  updateBalanceDisplay(); updateStats();

  gameState = S.RUNNING;
  document.getElementById('btn-start').disabled   = true;
  document.getElementById('btn-cashout').disabled = false;
  document.getElementById('btn-cashout').classList.add('glow');
  const mv = document.getElementById('multiplier-value');
  mv.textContent = '1.00x'; mv.classList.remove('danger-mult','spike-flash','pulse');
  document.getElementById('multiplier-sub').textContent = 'CASH OUT BEFORE CRASH!';
  document.getElementById('multiplier-sub').classList.remove('spike-text');

  lastTime = performance.now();
  animFrameId = requestAnimationFrame(gameLoop);
}

// ── UI ───────────────────────────────────
function updateMultiplierDisplay() {
  const mv = document.getElementById('multiplier-value');
  mv.textContent = multiplier.toFixed(2) + 'x';
  if (multiplier >= 6) mv.classList.add('danger-mult'); else mv.classList.remove('danger-mult');
  const prev = multiplier - CFG.MULT_GROWTH_BASE * 3;
  if (Math.floor(multiplier * 2) > Math.floor(prev * 2)) {
    mv.classList.remove('pulse'); void mv.offsetWidth; mv.classList.add('pulse');
  }
}

function updateBalanceDisplay() {
  document.getElementById('balance-display').textContent = balance.toLocaleString('tr-TR') + ' TL';
}

function updateStats() {
  document.getElementById('stat-bet').textContent    = currentBet ? currentBet + ' TL' : '---';
  document.getElementById('stat-score').textContent  = score;
  document.getElementById('stat-best').textContent   = bestScore;
  document.getElementById('stat-spikes').textContent = totalSpikes;
}

function showOverlay(type, title, detail) {
  const el = document.getElementById('overlay');
  el.className = 'overlay ' + (type === 'crash' ? 'crash-overlay' : 'cashout-overlay');
  document.getElementById('overlay-icon').textContent  = type === 'crash' ? '💀' : '🏆';
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-detail').innerHTML  = detail.replace(/\n/g, '<br>');
}

function hideOverlay() {
  document.getElementById('overlay').className = 'overlay hidden';
}

function flashScreen(color) {
  let a = 0.5;
  function fade() {
    ctx.fillStyle = color; ctx.globalAlpha = a;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1; a -= 0.06;
    if (a > 0) requestAnimationFrame(fade);
  }
  requestAnimationFrame(fade);
}

function blinkBalance(type) {
  const el = document.getElementById('balance-display');
  el.classList.remove('blink-green','blink-red'); void el.offsetWidth;
  el.classList.add(type === 'green' ? 'blink-green' : 'blink-red');
  setTimeout(() => el.classList.remove('blink-green','blink-red'), 600);
}

function shakeBetInput() {
  const el = document.getElementById('bet-input');
  el.style.borderColor = '#ff2244'; el.style.boxShadow = '0 0 12px rgba(255,34,68,0.5)';
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 700);
}

// ── SOUND ────────────────────────────────
let audioCtx = null;
function getAC() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type) {
  if (!soundOn) return;
  try {
    const a = getAC();
    if (type === 'spike') {
      [440, 880].forEach((freq, i) => {
        const o = a.createOscillator(), g = a.createGain();
        o.connect(g); g.connect(a.destination);
        o.type = 'square';
        o.frequency.setValueAtTime(freq, a.currentTime + i * 0.06);
        g.gain.setValueAtTime(0.12, a.currentTime + i * 0.06);
        g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + i * 0.06 + 0.09);
        o.start(a.currentTime + i * 0.06); o.stop(a.currentTime + i * 0.06 + 0.09);
      });
    } else if (type === 'crash') {
      const o = a.createOscillator(), g = a.createGain();
      o.connect(g); g.connect(a.destination);
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(30, a.currentTime + 0.5);
      g.gain.setValueAtTime(0.3, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.5);
      o.start(a.currentTime); o.stop(a.currentTime + 0.5);
    } else if (type === 'cashout') {
      [262, 330, 392, 523, 659].forEach((f, i) => {
        const o = a.createOscillator(), g = a.createGain();
        o.connect(g); g.connect(a.destination);
        o.type = 'square';
        o.frequency.setValueAtTime(f, a.currentTime);
        g.gain.setValueAtTime(0, a.currentTime + i * 0.07);
        g.gain.linearRampToValueAtTime(0.14, a.currentTime + i * 0.07 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + i * 0.07 + 0.12);
        o.start(a.currentTime + i * 0.07); o.stop(a.currentTime + i * 0.07 + 0.12);
      });
    }
  } catch(e) {}
}

// ── INPUT ────────────────────────────────
document.addEventListener('keydown', e => {
  if (gameState !== S.RUNNING) return;
  const map = { ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},w:{x:0,y:-1},s:{x:0,y:1},a:{x:-1,y:0},d:{x:1,y:0} };
  const d = map[e.key]; if (!d) return;
  if (d.x !== 0 && d.x === -direction.x) return;
  if (d.y !== 0 && d.y === -direction.y) return;
  nextDir = d;
  if (e.key.startsWith('Arrow')) e.preventDefault();
});

let touchStart = null;
canvas.addEventListener('touchstart', e => { touchStart = { x:e.touches[0].clientX, y:e.touches[0].clientY }; }, { passive:true });
canvas.addEventListener('touchend', e => {
  if (!touchStart || gameState !== S.RUNNING) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
  let nd = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? {x:1,y:0} : {x:-1,y:0}) : (dy > 0 ? {x:0,y:1} : {x:0,y:-1});
  if (nd.x !== 0 && nd.x === -direction.x) return;
  if (nd.y !== 0 && nd.y === -direction.y) return;
  nextDir = nd; touchStart = null;
}, { passive:true });

// ── BUTTONS ──────────────────────────────
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-cashout').addEventListener('click', cashOut);
document.getElementById('btn-reset').addEventListener('click', () => {
  if (gameState === S.RUNNING) return;
  balance = CFG.STARTING_BALANCE; updateBalanceDisplay(); blinkBalance('green');
});
document.getElementById('btn-minus').addEventListener('click', () => {
  const inp = document.getElementById('bet-input');
  const v = Math.max(CFG.MIN_BET, (parseInt(inp.value)||50) - 10);
  inp.value = v; highlightPreset(v);
});
document.getElementById('btn-plus').addEventListener('click', () => {
  const inp = document.getElementById('bet-input');
  const v = Math.min(CFG.MAX_BET, (parseInt(inp.value)||50) + 10);
  inp.value = v; highlightPreset(v);
});
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const amt = parseInt(btn.dataset.amount);
    document.getElementById('bet-input').value = amt; highlightPreset(amt);
  });
});
document.getElementById('bet-input').addEventListener('input', () => { highlightPreset(parseInt(document.getElementById('bet-input').value)); });
function highlightPreset(val) { document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.amount) === val)); }
document.getElementById('sound-toggle').addEventListener('click', () => {
  soundOn = !soundOn; document.getElementById('sound-toggle').textContent = soundOn ? 'SFX:ON' : 'SFX:OFF';
});

// ── INIT ─────────────────────────────────
resizeCanvas();
updateBalanceDisplay();
updateStats();
highlightPreset(50);
