/**
 * SNAKE CASHOUT – Türkçe Final Sürüm
 * ─────────────────────────────────────
 * RTP Matematiği (~%75):
 *   Kare başına çarpan artışı (60fps):
 *     Δçarpan = 0.004 × (1 + yenenYiyecek × 0.08)
 *
 *   Kare başına çarpışma olasılığı:
 *     p = 0.0026 × (çarpan ^ 1.5)
 *     → 1×: ~%0.26/kare,  3×: ~%1.35/kare,  5×: ~%2.9/kare
 *
 *   SPIKE MEKANİĞİ:
 *     Her yiyecek yenildiğinde anlık +0.10× çarpan artışı.
 *     Görsel: magenta rozet açılır, çerçeve çakar, sayaç renk değiştirir.
 */

'use strict';

/* ───────────────────────────────
   AYARLAR
─────────────────────────────── */
const CFG = {
  BASLANGIC_KREDI: 1000,
  MIN_BAHIS:       10,
  MAX_BAHIS:       250,
  IZGARA_SUTUN:    20,
  IZGARA_SATIR:    16,

  TEMEL_HIZ_MS:    145,
  HIZ_ARTISI:      4,
  MIN_HIZ_MS:      58,

  CARPAN_ARTIS:    0.004,
  YIYECEK_BONUS:   0.08,
  SPIKE_MIKTAR:    0.10,
  CARPAN_TAVAN:    10.0,

  TEMEL_RISK:      0.0026,
  RISK_UST:        1.5,

  // Piksel paleti
  ARKA_PLAN:       '#000000',
  IZGARA_RENK:     '#0a1a0a',
  YILAN_BAŞ:       '#00ff41',
  YILAN_GÖVDE1:    '#00cc33',
  YILAN_GÖVDE2:    '#009922',
  GOZ_BEYAZ:       '#ffffff',
  GOZ_BEREK:       '#000000',

  YIYECEK_RENK: ['#ff2244','#ffe600','#ff00cc','#00f0ff','#ff6e00','#aa44ff'],
};

/* ───────────────────────────────
   DURUM MAKİNESİ
─────────────────────────────── */
const DURUM = { BEKLEMEDE:'BEKLEMEDE', OYNANIYOR:'OYNANIYOR', CARPTI:'CARPTI', CIKIS_YAPILDI:'CIKIS_YAPILDI' };

let durum        = DURUM.BEKLEMEDE;
let kredi        = CFG.BASLANGIC_KREDI;
let mevcutBahis  = 0;
let carpan       = 1.0;
let yiyecekSayac = 0;
let skor         = 0;
let enIyiSkor    = 0;
let toplamSpike  = 0;
let sesAcik      = true;

let yilan        = [];
let yon          = { x:1, y:0 };
let sonrakiYon   = { x:1, y:0 };
let yiyecekler   = [];   // [{x,y,renk}]
let adimSayac    = 0;
let sonZaman     = 0;
let rafId        = null;
let adimAraligi  = CFG.TEMEL_HIZ_MS;
let kareSayaci   = 0;
let globalKare   = 0;

let yiyecekRenkIdx = 0;

/* ───────────────────────────────
   CANVAS
─────────────────────────────── */
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
let H = 0; // hücre boyutu (piksel)

function canvasBoyutlandir() {
  const sarici = document.getElementById('canvas-wrapper');
  const g = sarici.clientWidth;
  H = Math.floor(g / CFG.IZGARA_SUTUN);
  canvas.width  = H * CFG.IZGARA_SUTUN;
  canvas.height = H * CFG.IZGARA_SATIR;
  sarici.style.height = canvas.height + 'px';
  if (durum !== DURUM.OYNANIYOR) beklemeEkrani();
}
window.addEventListener('resize', canvasBoyutlandir);

/* ───────────────────────────────
   ÇIZIM – ARKA PLAN
─────────────────────────────── */
function arkaPlaniCiz() {
  ctx.fillStyle = CFG.ARKA_PLAN;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // noktalı ızgara
  ctx.fillStyle = CFG.IZGARA_RENK;
  for (let x = 0; x < CFG.IZGARA_SUTUN; x++)
    for (let y = 0; y < CFG.IZGARA_SATIR; y++)
      ctx.fillRect(x * H + H/2 - 1, y * H + H/2 - 1, 2, 2);
  // sınır
  ctx.strokeStyle = 'rgba(0,80,0,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, canvas.width-1, canvas.height-1);
}

/* ───────────────────────────────
   ÇIZIM – YILAN (piksel blok)
─────────────────────────────── */
function yilaniCiz() {
  for (let i = yilan.length - 1; i >= 0; i--) {
    const seg = yilan[i];
    const px  = seg.x * H;
    const py  = seg.y * H;

    if (i === 0) {
      // Baş
      ctx.fillStyle = CFG.YILAN_BAŞ;
      ctx.fillRect(px+1, py+1, H-2, H-2);

      // Köşe parlama
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(px+2, py+2, H-6, 2);
      ctx.fillRect(px+2, py+2, 2, H-6);

      // Gölge
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(px+H-3, py+2, 2, H-4);
      ctx.fillRect(px+2, py+H-3, H-4, 2);

      // Gözler
      const cx = px + H/2;
      const cy = py + H/2;
      const go = Math.floor(H * 0.27);
      const gf = Math.floor(H * 0.2);
      const gr = Math.max(2, Math.floor(H * 0.11));
      let gx1, gy1, gx2, gy2;
      if      (yon.x ===  1) { gx1=px+H-gf-2; gy1=cy-go; gx2=px+H-gf-2; gy2=cy+go-2; }
      else if (yon.x === -1) { gx1=px+gf;     gy1=cy-go; gx2=px+gf;     gy2=cy+go-2; }
      else if (yon.y === -1) { gx1=cx-go; gy1=py+gf;     gx2=cx+go-2; gy2=py+gf;     }
      else                   { gx1=cx-go; gy1=py+H-gf-2; gx2=cx+go-2; gy2=py+H-gf-2; }
      ctx.fillStyle = CFG.GOZ_BEYAZ;
      ctx.fillRect(gx1-gr, gy1-gr, gr*2, gr*2);
      ctx.fillRect(gx2-gr, gy2-gr, gr*2, gr*2);
      ctx.fillStyle = CFG.GOZ_BEREK;
      const gp = Math.ceil(gr/2);
      ctx.fillRect(gx1-gp, gy1-gp, gp*2, gp*2);
      ctx.fillRect(gx2-gp, gy2-gp, gp*2, gp*2);
    } else {
      // Gövde: alternatif renk + opaklık azalır
      const t    = i / yilan.length;
      const alfa = Math.max(0.3, 1 - t * 0.68);
      ctx.globalAlpha = alfa;
      ctx.fillStyle   = i % 2 === 0 ? CFG.YILAN_GÖVDE1 : CFG.YILAN_GÖVDE2;
      ctx.fillRect(px+2, py+2, H-4, H-4);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(px+3, py+3, H-8, 2);
      ctx.globalAlpha = 1;
    }
  }
}

/* ───────────────────────────────
   ÇIZIM – YİYECEK (arcade jeton)
─────────────────────────────── */
function yiyecekleriCiz() {
  yiyecekler.forEach(y => {
    const px  = y.x * H;
    const py  = y.y * H;
    const wobble = Math.floor(globalKare / 20) % 2 === 0 ? 0 : -1;
    const pad = Math.floor(H * 0.13);
    const sz  = H - pad * 2;
    const cx  = px + H/2;
    const cy  = py + H/2 + wobble;

    // dış parlama
    ctx.fillStyle   = y.renk;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(px, py+wobble, H, H);
    ctx.globalAlpha = 1;

    // jeton gövdesi
    ctx.fillStyle = y.renk;
    ctx.fillRect(px+pad, py+pad+wobble, sz, sz);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(px+pad+2, py+pad+2+wobble, sz-4, sz-4);

    // ✦ sembolü
    ctx.fillStyle = y.renk;
    const d = Math.max(2, Math.floor(H*0.11));
    const a = Math.floor(H*0.28);
    const b = Math.floor(H*0.11);
    const k = Math.floor(H*0.17);
    ctx.fillRect(cx-d, cy-d, d*2, d*2);
    ctx.fillRect(cx-d, cy-a, d*2, k);
    ctx.fillRect(cx-d, cy+b, d*2, k);
    ctx.fillRect(cx-a, cy-d, k, d*2);
    ctx.fillRect(cx+b, cy-d, k, d*2);

    // parlaklık
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(px+pad+1, py+pad+1+wobble, 2, 2);
  });
}

/* ───────────────────────────────
   ÇIZIM – BEKLEME EKRANI
─────────────────────────────── */
let _beklemeTick = 0;
function beklemeEkrani() {
  arkaPlaniCiz();
  // dekoratif yılan
  const seglar = [{x:12,y:8},{x:11,y:8},{x:10,y:8},{x:9,y:8},{x:8,y:8},{x:8,y:9},{x:8,y:10},{x:9,y:10}];
  ctx.globalAlpha = 0.28;
  seglar.forEach((s, i) => {
    ctx.fillStyle = i === 0 ? CFG.YILAN_BAŞ : CFG.YILAN_GÖVDE1;
    ctx.fillRect(s.x*H+1, s.y*H+1, H-2, H-2);
  });
  ctx.globalAlpha = 1;

  // yanıp sönen metin
  if (_beklemeTick % 2 === 0) {
    ctx.fillStyle = '#ffff00';
    ctx.font = `${Math.max(7, Math.floor(H*0.62))}px 'Press Start 2P', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = '#ffff00';
    ctx.shadowBlur   = 10;
    ctx.fillText('BAŞLAMAK İÇİN', canvas.width/2, canvas.height * 0.6);
    ctx.fillText('BAHİS GİR', canvas.width/2, canvas.height * 0.6 + H * 1.4);
    ctx.shadowBlur = 0;
  }
  _beklemeTick++;
  if (durum !== DURUM.OYNANIYOR) setTimeout(beklemeEkrani, 550);
}

/* ───────────────────────────────
   ÇIZIM – TAM KARE
─────────────────────────────── */
function tamKareciCiz() {
  globalKare++;
  arkaPlaniCiz();
  yiyecekleriCiz();
  yilaniCiz();
}

/* ───────────────────────────────
   OYUN MANTIĞI
─────────────────────────────── */
function yilaniBaslat() {
  const mx = Math.floor(CFG.IZGARA_SUTUN / 2);
  const my = Math.floor(CFG.IZGARA_SATIR / 2);
  yilan      = [{ x:mx, y:my }, { x:mx-1, y:my }, { x:mx-2, y:my }];
  yon        = { x:1, y:0 };
  sonrakiYon = { x:1, y:0 };
}

function yiyecekEkle() {
  while (yiyecekler.length < 2) {
    let konum, deneme = 0;
    do {
      konum = { x: Math.floor(Math.random() * CFG.IZGARA_SUTUN),
                y: Math.floor(Math.random() * CFG.IZGARA_SATIR) };
      deneme++;
    } while (
      deneme < 200 &&
      (yilan.some(s => s.x===konum.x && s.y===konum.y) ||
       yiyecekler.some(y => y.x===konum.x && y.y===konum.y))
    );
    const renk = CFG.YIYECEK_RENK[yiyecekRenkIdx % CFG.YIYECEK_RENK.length];
    yiyecekRenkIdx++;
    yiyecekler.push({ ...konum, renk });
  }
}

function yiyecekYendi(yenilen) {
  yiyecekler = yiyecekler.filter(y => y !== yenilen);
  yiyecekEkle();

  skor++;
  yiyecekSayac++;
  toplamSpike++;

  // ── SPIKE: anlık +0.10× ──
  carpan = Math.min(CFG.CARPAN_TAVAN, carpan + CFG.SPIKE_MIKTAR);
  carpanGuncelle(true);
  spikeBadgeGoster();
  adimAraligi = Math.max(CFG.MIN_HIZ_MS, adimAraligi - CFG.HIZ_ARTISI);
  sesOynat('spike');
  istatistikGuncelle();
  mobilCarpanGuncelle();
}

function carpismayiKontrolEt() {
  return Math.random() < CFG.TEMEL_RISK * Math.pow(carpan, CFG.RISK_UST);
}

function yilanAdimAt() {
  yon = { ...sonrakiYon };
  const bas    = yilan[0];
  const yeniBas = { x: bas.x + yon.x, y: bas.y + yon.y };

  // duvar çarpışması
  if (yeniBas.x < 0 || yeniBas.x >= CFG.IZGARA_SUTUN ||
      yeniBas.y < 0 || yeniBas.y >= CFG.IZGARA_SATIR) {
    carptiTetikle(); return;
  }
  // kendine çarpma
  if (yilan.some(s => s.x===yeniBas.x && s.y===yeniBas.y)) {
    carptiTetikle(); return;
  }

  yilan.unshift(yeniBas);
  const yenilen = yiyecekler.find(y => y.x===yeniBas.x && y.y===yeniBas.y);
  if (yenilen) {
    yiyecekYendi(yenilen);
  } else {
    yilan.pop();
  }
}

/* ───────────────────────────────
   OYUN DÖNGÜSÜ
─────────────────────────────── */
function oyunDongusu(zaman) {
  if (durum !== DURUM.OYNANIYOR) return;

  const dt = zaman - sonZaman;
  sonZaman = zaman;
  kareSayaci++;

  // çarpan büyüt
  const artis = CFG.CARPAN_ARTIS * (1 + yiyecekSayac * CFG.YIYECEK_BONUS);
  carpan = Math.min(CFG.CARPAN_TAVAN, carpan + artis);
  if (kareSayaci % 4 === 0) {
    carpanGuncelle(false);
    mobilCarpanGuncelle();
  }

  // olasılıksal çarpışma
  if (carpismayiKontrolEt()) {
    tamKareciCiz();
    carptiTetikle();
    return;
  }

  adimSayac += dt;
  if (adimSayac >= adimAraligi) {
    adimSayac -= adimAraligi;
    yilanAdimAt();
    if (durum !== DURUM.OYNANIYOR) return;
  }

  tamKareciCiz();
  rafId = requestAnimationFrame(oyunDongusu);
}

/* ───────────────────────────────
   ÇARPIŞMA / ÇIKIŞ
─────────────────────────────── */
function carptiTetikle() {
  durum = DURUM.CARPTI;
  cancelAnimationFrame(rafId); rafId = null;

  sesOynat('carpis');
  overlayGoster('carpis', 'OYUN BİTTİ', `${carpan.toFixed(2)}×'de ÇARPTI\n${mevcutBahis} TL KAYBETTİN`);
  durumMesajiAyarla(`ÇARPIŞMA! ${mevcutBahis} TL KAYBETTİN. TEKRAR DENE!`);
  document.getElementById('multiplier-value').classList.add('danger');
  document.getElementById('btn-start').disabled   = false;
  document.getElementById('btn-cashout').disabled = true;
  document.getElementById('btn-cashout').classList.remove('glow');
  mobilCashoutGizle();

  canvasFlash('rgba(255,0,0,0.22)');
  krediBlink('down');

  if (skor > enIyiSkor) {
    enIyiSkor = skor;
    document.getElementById('hiscore-marquee').textContent = enIyiSkor;
  }
  istatistikGuncelle();
}

function cikisYap() {
  if (durum !== DURUM.OYNANIYOR) return;
  durum = DURUM.CIKIS_YAPILDI;
  cancelAnimationFrame(rafId); rafId = null;

  const odeme = Math.floor(mevcutBahis * carpan);
  const kar   = odeme - mevcutBahis;
  kredi += odeme;

  sesOynat('cikis');
  krediGuncelle();

  overlayGoster('cikis', 'ÇIKIŞ YAPILDI!', `ÖDEME: ${odeme} TL\nKAR: +${kar} TL`);
  durumMesajiAyarla(`KAZANDIK! ${odeme} TL ÖDEME — ${carpan.toFixed(2)}×`);

  document.getElementById('btn-start').disabled   = false;
  document.getElementById('btn-cashout').disabled = true;
  document.getElementById('btn-cashout').classList.remove('glow');
  mobilCashoutGizle();

  const mv = document.getElementById('multiplier-value');
  mv.classList.remove('danger','spike-flash','tick');
  mv.style.transform = 'scale(1.15)';
  setTimeout(() => { mv.style.transform = ''; }, 280);

  krediBlink('up');
  if (skor > enIyiSkor) {
    enIyiSkor = skor;
    document.getElementById('hiscore-marquee').textContent = enIyiSkor;
  }
  istatistikGuncelle();
}

/* ───────────────────────────────
   BAŞLAT
─────────────────────────────── */
function oyunaBasla() {
  if (durum === DURUM.OYNANIYOR) return;

  const bahisVal = parseInt(document.getElementById('bet-input').value);
  if (isNaN(bahisVal) || bahisVal < CFG.MIN_BAHIS || bahisVal > CFG.MAX_BAHIS) { bahisHatasi(); return; }
  if (bahisVal > kredi) { bahisHatasi(); return; }

  mevcutBahis  = bahisVal;
  kredi       -= mevcutBahis;
  carpan       = 1.0;
  yiyecekSayac = 0;
  skor         = 0;
  adimAraligi  = CFG.TEMEL_HIZ_MS;
  adimSayac    = 0;
  kareSayaci   = 0;
  globalKare   = 0;
  yiyecekler   = [];
  yiyecekRenkIdx = 0;

  yilaniBaslat();
  yiyecekEkle();
  overlayGizle();
  krediGuncelle();
  istatistikGuncelle();
  mobilCashoutGoster();

  durum = DURUM.OYNANIYOR;
  document.getElementById('btn-start').disabled   = true;
  document.getElementById('btn-cashout').disabled = false;
  document.getElementById('btn-cashout').classList.add('glow');

  const mv = document.getElementById('multiplier-value');
  mv.textContent = '1.00×';
  mv.classList.remove('danger','spike-flash','tick');
  mv.style.transform = '';

  durumMesajiAyarla('OYUN BAŞLADI! JETONLARı TOPLA — ÇARPMADAN ÖNCE ÇIKIŞ YAP!');

  sonZaman = performance.now();
  rafId    = requestAnimationFrame(oyunDongusu);
}

/* ───────────────────────────────
   ARAYÜZ YARDIMCILARI
─────────────────────────────── */
function carpanGuncelle(isSpike) {
  const mv = document.getElementById('multiplier-value');
  mv.textContent = carpan.toFixed(2) + '×';
  if (carpan >= 6) mv.classList.add('danger');
  else mv.classList.remove('danger');

  if (isSpike) {
    mv.classList.remove('spike-flash','tick');
    void mv.offsetWidth;
    mv.classList.add('spike-flash');
  } else {
    const onceki = carpan - CFG.CARPAN_ARTIS * 4;
    if (Math.floor(carpan * 2) > Math.floor(onceki * 2)) {
      mv.classList.remove('tick');
      void mv.offsetWidth;
      mv.classList.add('tick');
    }
  }
}

function mobilCarpanGuncelle() {
  const el = document.getElementById('mobile-mult-preview');
  if (el) el.textContent = carpan.toFixed(2) + '×';
}

function mobilCashoutGoster() {
  document.getElementById('btn-mobile-cashout').classList.remove('hidden');
}
function mobilCashoutGizle() {
  document.getElementById('btn-mobile-cashout').classList.add('hidden');
}

function spikeBadgeGoster() {
  const badge = document.getElementById('spike-badge');
  badge.innerHTML = `+${CFG.SPIKE_MIKTAR.toFixed(2)}×<br>SPIKE!`;
  badge.classList.remove('show');
  void badge.offsetWidth;
  badge.classList.add('show');
  setTimeout(() => badge.classList.remove('show'), 900);

  const sarici = document.getElementById('canvas-wrapper');
  sarici.classList.add('spike-border');
  setTimeout(() => sarici.classList.remove('spike-border'), 420);
}

function durumMesajiAyarla(metin) {
  document.getElementById('status-text').textContent = metin;
}

function krediGuncelle() {
  document.getElementById('balance-display').textContent = kredi.toLocaleString('tr-TR');
}

function istatistikGuncelle() {
  document.getElementById('stat-score').textContent  = String(skor).padStart(2, '0');
  document.getElementById('stat-bet').textContent    = mevcutBahis ? mevcutBahis + ' TL' : '—';
  document.getElementById('stat-best').textContent   = String(enIyiSkor).padStart(2, '0');
  document.getElementById('stat-spikes').textContent = toplamSpike;
}

function overlayGoster(tip, baslik, detay) {
  const overlay = document.getElementById('overlay');
  overlay.className = 'overlay';
  const ikon  = document.getElementById('overlay-icon');
  const bas   = document.getElementById('overlay-title');
  const det   = document.getElementById('overlay-detail');
  if (tip === 'carpis') {
    ikon.textContent = '💀';
    bas.style.color  = '#ff2020';
    bas.style.textShadow = '0 0 14px #ff2020';
  } else {
    ikon.textContent = '★';
    bas.style.color  = '#ffff00';
    bas.style.textShadow = '0 0 14px #ffff00';
  }
  bas.textContent = baslik;
  det.textContent = detay;
  overlay.classList.remove('hidden');
}

function overlayGizle() {
  document.getElementById('overlay').className = 'overlay hidden';
}

function canvasFlash(renk) {
  let a = 0.5;
  const adim = () => {
    ctx.fillStyle = renk.replace('0.22', a.toFixed(2));
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    a -= 0.055;
    if (a > 0) requestAnimationFrame(adim);
  };
  requestAnimationFrame(adim);
}

function krediBlink(yon) {
  const el = document.getElementById('balance-display');
  el.classList.remove('blink-up','blink-down');
  void el.offsetWidth;
  el.classList.add(yon === 'up' ? 'blink-up' : 'blink-down');
  setTimeout(() => el.classList.remove('blink-up','blink-down'), 600);
}

function bahisHatasi() {
  const el = document.getElementById('bet-input');
  el.style.borderColor = '#ff2020';
  el.style.color       = '#ff2020';
  el.style.textShadow  = '0 0 10px #ff2020';
  setTimeout(() => { el.style.borderColor=''; el.style.color=''; el.style.textShadow=''; }, 700);
}

function presetVurgula(deger) {
  document.querySelectorAll('.preset-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.amount) === deger));
}

/* ───────────────────────────────
   SES MOTORU (Web Audio API)
─────────────────────────────── */
let sesKonteksi = null;
function sesAl() {
  if (!sesKonteksi) sesKonteksi = new (window.AudioContext || window.webkitAudioContext)();
  return sesKonteksi;
}

function sesOynat(tip) {
  if (!sesAcik) return;
  try {
    const a = sesAl();
    if (tip === 'spike') {
      // 8-bit çift blip
      [440, 880].forEach((frek, i) => {
        const o = a.createOscillator(), g = a.createGain();
        o.connect(g); g.connect(a.destination);
        o.type = 'square';
        o.frequency.setValueAtTime(frek, a.currentTime + i*0.055);
        g.gain.setValueAtTime(0.11, a.currentTime + i*0.055);
        g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + i*0.055 + 0.09);
        o.start(a.currentTime + i*0.055); o.stop(a.currentTime + i*0.055 + 0.09);
      });
    } else if (tip === 'carpis') {
      // İniş gürültüsü
      const buf = a.createBuffer(1, a.sampleRate*0.35, a.sampleRate);
      const veri = buf.getChannelData(0);
      for (let i = 0; i < veri.length; i++) veri[i] = (Math.random()*2-1) * (1-i/veri.length);
      const src = a.createBufferSource(), g = a.createGain();
      src.buffer = buf; src.connect(g); g.connect(a.destination);
      g.gain.setValueAtTime(0.28, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime+0.35);
      src.start(a.currentTime);

      const o2 = a.createOscillator(), g2 = a.createGain();
      o2.connect(g2); g2.connect(a.destination);
      o2.type = 'square';
      o2.frequency.setValueAtTime(110, a.currentTime);
      o2.frequency.exponentialRampToValueAtTime(28, a.currentTime+0.32);
      g2.gain.setValueAtTime(0.22, a.currentTime);
      g2.gain.exponentialRampToValueAtTime(0.001, a.currentTime+0.32);
      o2.start(a.currentTime); o2.stop(a.currentTime+0.32);
    } else if (tip === 'cikis') {
      // 8-bit zafer fanfarı
      [262,330,392,523,659].forEach((frek, i) => {
        const o = a.createOscillator(), g = a.createGain();
        o.connect(g); g.connect(a.destination);
        o.type = 'square';
        o.frequency.setValueAtTime(frek, a.currentTime+i*0.07);
        g.gain.setValueAtTime(0, a.currentTime+i*0.07);
        g.gain.linearRampToValueAtTime(0.13, a.currentTime+i*0.07+0.02);
        g.gain.exponentialRampToValueAtTime(0.001, a.currentTime+i*0.07+0.12);
        o.start(a.currentTime+i*0.07); o.stop(a.currentTime+i*0.07+0.12);
      });
    }
  } catch(e) {}
}

/* ───────────────────────────────
   GİRİŞ — KLAVYE
─────────────────────────────── */
document.addEventListener('keydown', e => {
  // Yön tuşları: her zaman kaydırmayı engelle (oyun dışında da)
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
    e.preventDefault();
  }

  if (durum !== DURUM.OYNANIYOR) return;

  // BOŞLUK = çıkış yap
  if (e.key === ' ') {
    cikisYap();
    return;
  }

  const harita = {
    ArrowUp:    {x:0,y:-1}, ArrowDown:  {x:0,y:1},
    ArrowLeft:  {x:-1,y:0}, ArrowRight: {x:1,y:0},
    w:{x:0,y:-1}, s:{x:0,y:1}, a:{x:-1,y:0}, d:{x:1,y:0},
  };
  const nd = harita[e.key];
  if (!nd) return;
  if (nd.x !== 0 && nd.x === -yon.x) return;
  if (nd.y !== 0 && nd.y === -yon.y) return;
  sonrakiYon = nd;
});

/* ───────────────────────────────
   GİRİŞ — DOKUNMA (sayfa kaydırmayı engelle)
─────────────────────────────── */
let dokunmaBaslangici = null;

// touchstart: passive:false ile sayfa kaydırmasını engelleyebiliyoruz
canvas.addEventListener('touchstart', e => {
  // Oyun sırasında sayfanın scroll'ünü tamamen durdur
  if (durum === DURUM.OYNANIYOR) e.preventDefault();
  dokunmaBaslangici = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  // Oyun sırasında scroll'ü durdur
  if (durum === DURUM.OYNANIYOR) e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (!dokunmaBaslangici || durum !== DURUM.OYNANIYOR) return;
  const dx = e.changedTouches[0].clientX - dokunmaBaslangici.x;
  const dy = e.changedTouches[0].clientY - dokunmaBaslangici.y;
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;

  let nd;
  if (Math.abs(dx) > Math.abs(dy)) nd = dx > 0 ? {x:1,y:0} : {x:-1,y:0};
  else nd = dy > 0 ? {x:0,y:1} : {x:0,y:-1};

  if (nd.x !== 0 && nd.x === -yon.x) return;
  if (nd.y !== 0 && nd.y === -yon.y) return;
  sonrakiYon = nd;
  dokunmaBaslangici = null;
}, { passive: true });

// Tüm sayfa için de scroll engelleyelim (gövde üzerinde swipe)
document.body.addEventListener('touchmove', e => {
  if (durum === DURUM.OYNANIYOR) e.preventDefault();
}, { passive: false });

/* ───────────────────────────────
   BUTONLAR
─────────────────────────────── */
document.getElementById('btn-start').addEventListener('click', oyunaBasla);
document.getElementById('btn-cashout').addEventListener('click', cikisYap);
document.getElementById('btn-mobile-cashout').addEventListener('click', cikisYap);

document.getElementById('btn-reset').addEventListener('click', () => {
  if (durum === DURUM.OYNANIYOR) return;
  kredi = CFG.BASLANGIC_KREDI;
  krediGuncelle();
  krediBlink('up');
  durumMesajiAyarla('KREDİ 1000 TL\'YE SIFIRLANDIKTI. KOLAY GELSİN!');
});

document.getElementById('btn-minus').addEventListener('click', () => {
  const inp = document.getElementById('bet-input');
  const v   = Math.max(CFG.MIN_BAHIS, (parseInt(inp.value)||50) - 10);
  inp.value = v; presetVurgula(v);
});
document.getElementById('btn-plus').addEventListener('click', () => {
  const inp = document.getElementById('bet-input');
  const v   = Math.min(CFG.MAX_BAHIS, (parseInt(inp.value)||50) + 10);
  inp.value = v; presetVurgula(v);
});
document.querySelectorAll('.preset-btn').forEach(b => {
  b.addEventListener('click', () => {
    const v = parseInt(b.dataset.amount);
    document.getElementById('bet-input').value = v;
    presetVurgula(v);
  });
});
document.getElementById('bet-input').addEventListener('input', () => {
  presetVurgula(parseInt(document.getElementById('bet-input').value));
});

document.getElementById('sound-toggle').addEventListener('click', () => {
  sesAcik = !sesAcik;
  document.getElementById('sound-toggle').textContent = sesAcik ? 'SES: AÇIK' : 'SES: KAPALI';
});

/* ───────────────────────────────
   BAŞLATMA
─────────────────────────────── */
canvasBoyutlandir();
krediGuncelle();
istatistikGuncelle();
presetVurgula(50);
// beklemeEkrani() kendi döngüsünü çalıştırıyor
