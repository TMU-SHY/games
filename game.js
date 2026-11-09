(() => {
  'use strict';

  // ================= 常數 =================
  const COLS = 15, ROWS = 13, T = 32;
  const EMPTY = 0, WALL = 1, BRICK = 2, BURN = 3;
  const FUSE = 2.5, FLAME_TIME = 0.5;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DIR_LIST = Object.values(DIRS);
  const ENEMY = {
    balloom: { speed: 1.4, smart: 0,    pts: 100, color: '#ff8a3d', dark: '#c4581a' },
    oneal:   { speed: 2.0, smart: 0.55, pts: 200, color: '#4fa3ff', dark: '#1f63b8' },
    doll:    { speed: 2.5, smart: 0.25, pts: 400, color: '#ff6ec7', dark: '#b8358a' },
  };

  // 敵人 AI 難度：speed = 速度倍率、chase = 追擊機率(依敵人原本 smart 值換算)、
  // range = 追擊感知距離、dodge = 閃避炸彈、path = BFS 尋路追殺
  const AI_LEVELS = [null,
    { name: '遲鈍', desc: '慢吞吞，只會亂走',        speed: 0.8,  chase: s => 0,              range: 0,  dodge: false, path: false },
    { name: '簡單', desc: '偶爾會追你',              speed: 0.9,  chase: s => s * 0.5,        range: 6,  dodge: false, path: false },
    { name: '普通', desc: '會追蹤附近的玩家',        speed: 1.0,  chase: s => s,              range: 9,  dodge: false, path: false },
    { name: '困難', desc: '更快、更愛追、會閃避炸彈', speed: 1.12, chase: s => 0.35 + s * 0.6, range: 12, dodge: true,  path: false },
    { name: '地獄', desc: '全速尋路追殺並閃避炸彈',   speed: 1.25, chase: s => 0.6 + s * 0.4,  range: 99, dodge: true,  path: true  },
  ];

  // 2P 電腦玩家 AI：mistake = 亂走/亂放炸彈機率、pause = 每步後發呆時間、
  // safeBomb = 放炸彈前確認退路的機率、escape = 察覺危險並逃跑的機率、items = 會去撿道具、
  // hunt = 主動獵殺敵人的機率、huntPlayer = 把 1P 當成目標的機率、avoidEnemy = 與敵人保持距離
  const BOT_LEVELS = [null,
    { mistake: 0.35, pause: 0.45, safeBomb: 0.3, escape: 0.6, items: false, hunt: 0,   huntPlayer: 0,    avoidEnemy: false },
    { mistake: 0.2,  pause: 0.25, safeBomb: 0.7, escape: 0.9, items: true,  hunt: 0.2, huntPlayer: 0.1,  avoidEnemy: false },
    { mistake: 0.1,  pause: 0.12, safeBomb: 1,   escape: 1,   items: true,  hunt: 0.5, huntPlayer: 0.3,  avoidEnemy: true  },
    { mistake: 0.04, pause: 0.05, safeBomb: 1,   escape: 1,   items: true,  hunt: 0.8, huntPlayer: 0.55, avoidEnemy: true  },
    { mistake: 0,    pause: 0,    safeBomb: 1,   escape: 1,   items: true,  hunt: 1,   huntPlayer: 0.8,  avoidEnemy: true  },
  ];

  const SPAWN = { 1: [1, 1], 2: [COLS - 2, ROWS - 2] };
  const SKINS = {
    1: { head: '#ffffff', shine: '#ffffffcc', body: '#2b59c3', ball: '#ff4f7b' },
    2: { head: '#3a3a48', shine: '#8a8aa0',   body: '#c62828', ball: '#4fa3ff' },
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = COLS * T;
  canvas.height = ROWS * T;

  const $ = id => document.getElementById(id);
  const ui = {
    stage: $('hud-stage'), time: $('hud-time'), ai: $('hud-ai'), p2: $('hud-p2'),
    overlay: $('overlay'), title: $('ov-title'), text: $('ov-text'), help: $('ov-help'),
    aiSelect: $('ai-select'), aiDesc: $('ai-desc'), aiButtons: document.querySelectorAll('#ai-select button'),
    p2Select: $('p2-select'), p2Buttons: document.querySelectorAll('#p2-select button'),
  };

  // ================= 音效（WebAudio 8-bit 嗶聲） =================
  let actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 無音效 */ } }
    if (actx && actx.state === 'suspended') actx.resume();
  }
  function beep(freq, dur, type = 'square', vol = 0.06, slide = 0) {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(t0 + dur);
  }
  function noise(dur, vol = 0.25) {
    if (!actx) return;
    const len = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    s.buffer = buf; f.type = 'lowpass'; f.frequency.value = 800; g.gain.value = vol;
    s.connect(f).connect(g).connect(actx.destination);
    s.start();
  }
  const sfx = {
    place: () => beep(180, 0.08),
    boom:  () => noise(0.6),
    item:  () => { beep(660, 0.08); setTimeout(() => beep(990, 0.14), 80); },
    kill:  () => beep(900, 0.2, 'triangle', 0.08, -700),
    die:   () => beep(520, 0.9, 'sawtooth', 0.06, -470),
    clear: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.16), i * 130)),
    start: () => [392, 523, 659].forEach((f, i) => setTimeout(() => beep(f, 0.12), i * 110)),
  };

  // ================= 遊戲狀態 =================
  let grid, items, hidden, bombs, flames, burning, enemies, popups;
  let players = [];
  let state = 'title', stateT = 0, clock = 0, shake = 0;
  let stage = 1, timeLeft = 200, clearBy = null;
  let danger = new Set();    // 炸彈波及範圍 + 火焰（給會閃避的 AI 用）
  let enemyNear = new Set(); // 敵人所在及相鄰格（給 2P 電腦閃避敵人用）
  let enemyCore = new Set(); // 敵人實際佔據的格子（移動中算前後兩格）
  let aiLevel = 3, p2Mode = 'ai';
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');

  try {
    aiLevel = Math.min(5, Math.max(1, parseInt(localStorage.getItem('bomber.ai'), 10) || 3));
    p2Mode = localStorage.getItem('bomber.p2') || 'ai';
  } catch (e) { /* 無儲存空間 */ }

  const key = (c, r) => r * COLS + c;
  const tileAt = (c, r) => grid[key(c, r)];
  const bombAt = (c, r) => bombs.find(b => b.c === c && b.r === r);
  const flameAt = (c, r) => flames.find(f => f.c === c && f.r === r);
  const tileOf = e => [Math.round(e.x), Math.round(e.y)];
  const rand = n => Math.floor(Math.random() * n);
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const livePlayers = () => players.filter(p => p.alive && !p.out);
  const opponentOf = p => players.find(q => q !== p && q.alive && !q.out);

  function setAiLevel(lv) {
    aiLevel = Math.min(5, Math.max(1, lv));
    try { localStorage.setItem('bomber.ai', aiLevel); } catch (e) { /* 無儲存空間 */ }
    ui.aiButtons.forEach(b => b.classList.toggle('active', +b.dataset.lv === aiLevel));
    ui.aiDesc.textContent = `Lv${aiLevel} ${AI_LEVELS[aiLevel].name}：${AI_LEVELS[aiLevel].desc}`;
    beep(300 + aiLevel * 120, 0.06);
  }

  function setP2Mode(m) {
    if (!(m in { off: 1, ai: 1, human: 1 }) || (isTouch && m === 'human')) m = 'ai';
    p2Mode = m;
    try { localStorage.setItem('bomber.p2', p2Mode); } catch (e) { /* 無儲存空間 */ }
    ui.p2Buttons.forEach(b => b.classList.toggle('active', b.dataset.mode === p2Mode));
    beep(500, 0.06);
  }

  // ================= 玩家 =================
  function makePlayer(id, isAI) {
    return { id, isAI, lives: 3, score: 0, out: false, bombReq: false, stats: { maxBombs: 1, range: 1, speed: 3.2 } };
  }

  function spawnPlayer(p) {
    const [c, r] = SPAWN[p.id];
    Object.assign(p, {
      x: c, y: r, dir: 'down', moving: false, anim: 0, alive: true, deathT: 0, inv: 0,
      bot: { tx: c, ty: r, fc: c, fr: r, wait: 0.4 },
    });
  }

  function killPlayer(p, by) {
    if (!p.alive || p.out) return;
    p.alive = false; p.deathT = 0;
    sfx.die();
    const killer = players.find(q => q.id === by);
    if (killer && killer !== p) {
      killer.score += 1000;
      popups.push({ x: p.x, y: p.y, text: `${killer.id}P +1000`, t: 1.2 });
    }
  }

  function buildStage() {
    grid = []; items = new Map(); hidden = new Map();
    bombs = []; flames = []; burning = []; enemies = []; popups = [];
    const density = Math.min(0.36 + stage * 0.02, 0.5);
    const nearSpawn = (c, r) => c + r <= 3 || (COLS - 1 - c) + (ROWS - 1 - r) <= 3;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        let v = EMPTY;
        if (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1 || (r % 2 === 0 && c % 2 === 0)) v = WALL;
        else if (!nearSpawn(c, r) && Math.random() < density) v = BRICK; // 兩個出生點保留安全區
        grid.push(v);
      }
    }
    // 磚塊下藏出口與道具（雙人時多放一些道具）
    const bricks = shuffle(grid.map((v, i) => v === BRICK ? i : -1).filter(i => i >= 0));
    hidden.set(bricks[0], 'door');
    const pool = ['bomb', 'fire', 'speed'];
    const itemCount = players.length > 1 ? 4 : 2;
    for (let i = 1; i <= itemCount; i++) hidden.set(bricks[i], pool[rand(pool.length)]);

    players.forEach(p => { if (!p.out) spawnPlayer(p); });

    const types = ['balloom'];
    if (stage >= 2) types.push('oneal');
    if (stage >= 3) types.push('doll');
    const free = shuffle(grid.map((v, i) => {
      const c = i % COLS, r = Math.floor(i / COLS);
      return v === EMPTY && c + r >= 8 && (COLS - 1 - c) + (ROWS - 1 - r) >= 8 ? i : -1;
    }).filter(i => i >= 0));
    const count = Math.min(2 + stage, 10, free.length);
    for (let i = 0; i < count; i++) {
      const c = free[i] % COLS, r = Math.floor(free[i] / COLS);
      enemies.push({ x: c, y: r, tx: c, ty: r, dx: 0, dy: 0, type: types[rand(types.length)], alive: true, deathT: 0, anim: Math.random() * 10 });
    }
    timeLeft = 200;
  }

  // ================= 狀態 / 畫面切換 =================
  function setState(s) {
    state = s; stateT = 0;
    const show = (title, text, help = '') => {
      ui.title.innerHTML = title; ui.text.textContent = text; ui.help.innerHTML = help;
      ui.help.style.display = help ? '' : 'none';
      ui.overlay.classList.remove('hidden');
    };
    ui.aiSelect.style.display = ['title', 'paused', 'gameover'].includes(s) ? '' : 'none';
    ui.p2Select.style.display = ['title', 'gameover'].includes(s) ? '' : 'none';
    const vs = players.length > 1;
    switch (s) {
      case 'title':
        show('BOMBER<br>RETRO', isTouch ? 'TAP TO START' : 'PRESS ENTER',
          isTouch ? '點選按鈕調整難度與 2P' : '← → / 1-5 選難度　↑ ↓ 切換 2P');
        break;
      case 'stagestart': show(`STAGE ${stage}`, players.filter(p => !p.out).map(p => `${p.id}P ♥${p.lives}`).join('   ')); break;
      case 'paused':     show('PAUSE', isTouch ? 'TAP TO RESUME' : 'PRESS P'); break;
      case 'clear':      show(vs ? `${clearBy.id}P<br>CLEAR!` : 'STAGE<br>CLEAR!', `${vs ? clearBy.id + 'P ' : ''}BONUS ${Math.ceil(timeLeft) * 10}`); break;
      case 'gameover': {
        let result = '';
        if (vs) {
          const alive = players.filter(p => !p.out);
          const [a, b] = players;
          const winner = alive.length === 1 ? alive[0] : (a.score === b.score ? null : (a.score > b.score ? a : b));
          result = winner ? `<b style="color:var(--accent)">${winner.id}P WINS!</b><br>` : '<b>DRAW</b><br>';
        }
        show('GAME<br>OVER', players.map(p => `${vs ? p.id + 'P ' : 'SCORE '}${p.score}`).join('   '),
          result + (isTouch ? '點擊畫面重新開始' : '按 ENTER 重新開始'));
        break;
      }
      default: ui.overlay.classList.add('hidden');
    }
  }

  function startGame() {
    stage = 1;
    players = [makePlayer(1, false)];
    if (p2Mode !== 'off') players.push(makePlayer(2, p2Mode === 'ai'));
    ui.p2.classList.toggle('hidden', players.length < 2);
    sfx.start();
    startStage();
  }
  function startStage() { buildStage(); setState('stagestart'); }

  function togglePause() {
    if (state === 'play') setState('paused');
    else if (state === 'paused') setState('play');
  }

  function action() {
    audio();
    if (state === 'title' || state === 'gameover') startGame();
    else if (state === 'paused') setState('play');
    else if (state === 'play' && players[0]) players[0].bombReq = true;
  }

  function checkGameOver() {
    // 所有「真人」玩家都出局才結束；AI 2P 出局時 1P 繼續玩
    if (players.filter(p => !p.isAI).every(p => p.out)) setState('gameover');
  }

  // ================= 移動（含轉角自動對齊） =================
  function moveEntity(e, dx, dy, s, canWalk) {
    const horiz = dx !== 0, d = horiz ? dx : dy;
    const main = horiz ? 'x' : 'y', side = horiz ? 'y' : 'x';
    const at = (m, sd) => horiz ? canWalk(m, sd) : canWalk(sd, m);
    const cm = Math.round(e[main]), cs = Math.round(e[side]), off = e[side] - cs;

    if (Math.abs(off) > 0.01) {
      // 不在格線上：往可通行的那一列/欄滑過去
      let target = null;
      if (at(cm + d, cs)) target = cs;
      else if (Math.abs(off) > 0.25 && at(cm + d, cs + Math.sign(off))) target = cs + Math.sign(off);
      if (target !== null) {
        const diff = target - e[side];
        e[side] += Math.sign(diff) * Math.min(Math.abs(diff), s);
      }
      return;
    }
    e[side] = cs;
    let n = e[main] + d * s;
    if (!at(cm + d, cs)) n = d > 0 ? Math.min(n, Math.max(e[main], cm)) : Math.max(n, Math.min(e[main], cm));
    e[main] = n;
  }

  function playerCanWalk(p, c, r) {
    if (tileAt(c, r) !== EMPTY) return false;
    // 炸彈會擋路，除非玩家目前就站在那顆炸彈上
    if (bombAt(c, r) && !(Math.round(p.x) === c && Math.round(p.y) === r)) return false;
    return true;
  }
  const enemyCanWalk = (c, r) => tileAt(c, r) === EMPTY && !bombAt(c, r);

  // ================= 炸彈與爆炸 =================
  const bombsOf = p => bombs.filter(b => b.owner === p.id).length;

  function placeBomb(p) {
    const [c, r] = tileOf(p);
    if (bombsOf(p) >= p.stats.maxBombs || bombAt(c, r) || tileAt(c, r) !== EMPTY) return false;
    bombs.push({ c, r, t: FUSE, range: p.stats.range, owner: p.id });
    sfx.place();
    return true;
  }

  // 炸彈的爆炸範圍（不含被磚塊/牆擋住的格子）
  function blastTiles(c, r, range) {
    const out = [key(c, r)];
    for (const [dx, dy] of DIR_LIST) {
      for (let n = 1; n <= range; n++) {
        const cc = c + dx * n, rr = r + dy * n;
        if (tileAt(cc, rr) !== EMPTY) break;
        out.push(key(cc, rr));
      }
    }
    return out;
  }

  function addFlame(c, r, kind, dx, dy, owner) { flames.push({ c, r, kind, dx, dy, owner, t: FLAME_TIME }); }

  function explode(b) {
    const i = bombs.indexOf(b);
    if (i < 0) return;
    bombs.splice(i, 1);
    sfx.boom();
    shake = 0.25;
    addFlame(b.c, b.r, 'center', 0, 0, b.owner);
    for (const [dx, dy] of DIR_LIST) {
      for (let n = 1; n <= b.range; n++) {
        const c = b.c + dx * n, r = b.r + dy * n, k = key(c, r), v = grid[k];
        if (v === WALL || v === BURN) break;
        if (v === BRICK) { grid[k] = BURN; burning.push({ c, r, t: FLAME_TIME }); break; }
        const other = bombAt(c, r);
        if (other) { other.t = Math.min(other.t, 0.06); break; } // 連鎖引爆
        const kind = n === b.range ? 'end' : 'mid';
        const it = items.get(k);
        if (it && it !== 'door') { items.delete(k); addFlame(c, r, 'end', dx, dy, b.owner); break; } // 道具被炸毀
        addFlame(c, r, kind, dx, dy, b.owner);
      }
    }
  }

  function computeDanger() {
    const set = new Set();
    for (const f of flames) set.add(key(f.c, f.r));
    for (const b of bombs) for (const k of blastTiles(b.c, b.r, b.range)) set.add(k);
    return set;
  }

  function computeEnemyZones() {
    enemyNear = new Set(); enemyCore = new Set();
    for (const e of enemies) {
      if (!e.alive) continue;
      // 移動中的敵人同時算它前後兩格，以及牠要前往的格子
      for (const [ec, er] of [[Math.floor(e.x), Math.floor(e.y)], [Math.ceil(e.x), Math.ceil(e.y)], [e.tx, e.ty]]) {
        enemyCore.add(key(ec, er));
        enemyNear.add(key(ec, er));
        for (const d of DIR_LIST) enemyNear.add(key(ec + d[0], er + d[1]));
      }
    }
  }

  // BFS：回傳從 (c,r) 走到第一個符合 isGoal 的格子時，第一步的方向與距離
  function bfs(c, r, pass, isGoal, maxDepth = 99) {
    const start = key(c, r), info = new Map([[start, { dir: null, d: 0 }]]), q = [start];
    for (let qi = 0; qi < q.length; qi++) {
      const k = q[qi], cur = info.get(k);
      if (k !== start && isGoal(k)) return { dir: cur.dir, dist: cur.d, k };
      if (cur.d >= maxDepth) continue;
      const kc = k % COLS, kr = (k - kc) / COLS;
      for (const d of DIR_LIST) {
        const nc = kc + d[0], nr = kr + d[1], nk = key(nc, nr);
        if (info.has(nk) || !pass(nc, nr)) continue;
        info.set(nk, { dir: cur.dir || d, d: cur.d + 1 });
        q.push(nk);
      }
    }
    return null;
  }

  // ================= 敵人 AI =================
  function nearestPlayer(c, r) {
    let best = null, bd = Infinity;
    for (const p of livePlayers()) {
      const d = Math.abs(p.x - c) + Math.abs(p.y - r);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function chooseDir(e) {
    const c = e.tx, r = e.ty;
    e.x = c; e.y = r;
    let opts = DIR_LIST.filter(([dx, dy]) => enemyCanWalk(c + dx, r + dy));
    if (!opts.length) { e.dx = e.dy = 0; return; }
    const def = ENEMY[e.type], ai = AI_LEVELS[aiLevel];
    let pick = null;
    if (ai.dodge) {
      if (danger.has(key(c, r))) {
        // 站在爆炸範圍內 → 找最近的安全格逃跑
        pick = bfs(c, r, enemyCanWalk, k => !danger.has(k))?.dir || null;
      } else {
        const safe = opts.filter(([dx, dy]) => !danger.has(key(c + dx, r + dy)));
        if (!safe.length) { e.dx = e.dy = 0; return; } // 四周都危險 → 原地等
        opts = safe;
      }
    }
    const prey = nearestPlayer(c, r);
    if (!pick && prey && Math.random() < ai.chase(def.smart)) {
      const [px, py] = tileOf(prey);
      if (Math.abs(px - c) + Math.abs(py - r) < ai.range) {
        if (ai.path) {
          const pass = (nc, nr) => enemyCanWalk(nc, nr) && !(ai.dodge && danger.has(key(nc, nr)));
          pick = bfs(c, r, pass, k => k === key(px, py))?.dir || null;
        }
        if (!pick) pick = opts.reduce((best, o) => {
          const d = Math.abs(px - c - o[0]) + Math.abs(py - r - o[1]);
          return !best || d < best.d ? { o, d } : best;
        }, null).o;
      }
    }
    if (!pick) {
      const fwd = opts.find(o => o[0] === e.dx && o[1] === e.dy);
      const noBack = opts.filter(o => !(o[0] === -e.dx && o[1] === -e.dy && (e.dx || e.dy)));
      pick = fwd && Math.random() < 0.7 ? fwd : (noBack.length ? noBack : opts)[rand((noBack.length ? noBack : opts).length)];
    }
    [e.dx, e.dy] = pick;
    e.tx = c + e.dx; e.ty = r + e.dy;
  }

  function updateEnemy(e, dt) {
    if (!e.alive) { e.deathT += dt; return; }
    e.anim += dt;
    // 前方突然出現炸彈 → 掉頭
    if ((e.dx || e.dy) && !enemyCanWalk(e.tx, e.ty)) {
      e.tx -= e.dx; e.ty -= e.dy; e.dx = -e.dx; e.dy = -e.dy;
    }
    let step = ENEMY[e.type].speed * AI_LEVELS[aiLevel].speed * dt;
    for (let guard = 0; step > 0 && guard < 4; guard++) {
      const ddx = e.tx - e.x, ddy = e.ty - e.y, dist = Math.abs(ddx) + Math.abs(ddy);
      if (dist < 1e-6) { chooseDir(e); if (!e.dx && !e.dy) break; continue; }
      const m = Math.min(dist, step);
      e.x += Math.sign(ddx) * m; e.y += Math.sign(ddy) * m;
      step -= m;
    }
  }

  // ================= 2P 電腦玩家 AI =================
  function botGo(p, dir, L) {
    const [c, r] = tileOf(p), b = p.bot;
    b.fc = c; b.fr = r;
    b.tx = c + dir[0]; b.ty = r + dir[1];
    b.wait = L.pause * Math.random();
  }

  function botWander(p, pass, L) {
    const [c, r] = tileOf(p);
    const opts = DIR_LIST.filter(d => pass(c + d[0], r + d[1]));
    if (opts.length) botGo(p, opts[rand(opts.length)], L);
    else p.bot.wait = 0.2;
  }

  // 從 (c,r) 放炸彈會炸到什麼
  function blastCheck(p, c, r, foeAllowed) {
    const res = { brick: false, enemy: false, foe: false };
    const foe = foeAllowed ? opponentOf(p) : null;
    const foeTile = foe && key(...tileOf(foe));
    const enemyTiles = new Set(enemies.filter(e => e.alive).map(e => key(...tileOf(e))));
    for (const [dx, dy] of DIR_LIST) {
      for (let n = 1; n <= p.stats.range; n++) {
        const cc = c + dx * n, rr = r + dy * n, v = tileAt(cc, rr), k = key(cc, rr);
        if (v === BRICK) { res.brick = true; break; }
        if (v !== EMPTY) break;
        if (enemyTiles.has(k)) res.enemy = true;
        if (k === foeTile) res.foe = true;
      }
    }
    return res;
  }

  // 假設在 (c,r) 放下炸彈，引爆前是否來得及跑到安全格
  function canEscape(p, c, r, L) {
    const d2 = new Set(danger);
    for (const k of blastTiles(c, r, p.stats.range)) d2.add(k);
    const maxD = Math.max(2, Math.floor(FUSE * p.stats.speed) - 2);
    const pass = (cc, rr) => tileAt(cc, rr) === EMPTY && !bombAt(cc, rr) && !flameAt(cc, rr) &&
      !(L.avoidEnemy && enemyNear.has(key(cc, rr)));
    return !!bfs(c, r, pass, k => !d2.has(k), maxD);
  }

  function botDecide(p, L) {
    const [c, r] = tileOf(p), here = key(c, r);
    p.x = c; p.y = r;
    const free = (cc, rr) => tileAt(cc, rr) === EMPTY && !bombAt(cc, rr) && !flameAt(cc, rr) &&
      !(L.avoidEnemy && enemyCore.has(key(cc, rr)));
    const nearEnemy = L.avoidEnemy ? enemyNear : new Set();
    const safe = (cc, rr) => free(cc, rr) && !danger.has(key(cc, rr)) && !nearEnemy.has(key(cc, rr));

    // 1. 身處爆炸範圍 → 逃到最近的安全格（優先走不會撞上敵人的路）
    if (danger.has(here)) {
      if (Math.random() < L.escape) {
        const res = bfs(c, r, (cc, rr) => free(cc, rr) && !nearEnemy.has(key(cc, rr)), k => !danger.has(k)) ||
                    bfs(c, r, free, k => !danger.has(k) && !nearEnemy.has(k)) ||
                    bfs(c, r, free, k => !danger.has(k));
        if (res) return botGo(p, res.dir, { pause: 0 });
      }
      return botWander(p, free, { pause: 0 });
    }

    // 2. 失誤：亂走，甚至亂放炸彈
    if (Math.random() < L.mistake) {
      if (Math.random() < 0.3) placeBomb(p);
      return botWander(p, free, L);
    }

    // 3. 判斷是否要放炸彈（炸磚、炸敵人、炸 1P）
    const exitOpen = enemies.length === 0 && [...items.values()].includes('door');
    if (bombsOf(p) < p.stats.maxBombs && !bombAt(c, r)) {
      const h = blastCheck(p, c, r, Math.random() < L.huntPlayer);
      const want = h.enemy || h.foe || (h.brick && !exitOpen);
      if (want && (Math.random() > L.safeBomb || canEscape(p, c, r, L))) {
        placeBomb(p);
        p.bot.wait = 0;
        return; // 下一幀會發現自己在危險區而逃跑
      }
    }

    // 4. 與敵人保持距離
    if (nearEnemy.has(here)) {
      const res = bfs(c, r, (cc, rr) => free(cc, rr) && !danger.has(key(cc, rr)), k => !nearEnemy.has(k), 4);
      if (res) return botGo(p, res.dir, L);
    }

    // 5. 目標：出口 > 道具 > 獵殺 > 炸磚
    let res = null;
    if (enemies.length === 0) res = bfs(c, r, safe, k => items.get(k) === 'door');
    if (!res && L.items) res = bfs(c, r, safe, k => { const it = items.get(k); return it && it !== 'door'; }, 12);
    if (!res && Math.random() < L.hunt) {
      const targets = new Set(enemies.filter(e => e.alive).map(e => key(...tileOf(e))));
      const foe = opponentOf(p);
      if (foe && Math.random() < L.huntPlayer) targets.add(key(...tileOf(foe)));
      if (targets.size) {
        res = bfs(c, r, safe, k => {
          const kc = k % COLS, kr = (k - kc) / COLS;
          return blastTiles(kc, kr, p.stats.range).some(t => targets.has(t));
        }, 15);
      }
    }
    if (!res && !exitOpen) {
      res = bfs(c, r, safe, k => {
        const kc = k % COLS, kr = (k - kc) / COLS;
        return DIR_LIST.some(d => tileAt(kc + d[0], kr + d[1]) === BRICK);
      }, 20);
    }
    if (res) return botGo(p, res.dir, L);
    botWander(p, safe, L);
  }

  function updateBot(p, dt) {
    const L = BOT_LEVELS[aiLevel], b = p.bot;
    const s = p.stats.speed * dt;
    if (Math.abs(b.tx - p.x) > 1e-4 || Math.abs(b.ty - p.y) > 1e-4) {
      // 目標格被擋住或變危險 → 退回原本那格
      const blocked = tileAt(b.tx, b.ty) !== EMPTY || bombAt(b.tx, b.ty);
      const tk = key(b.tx, b.ty), fk = key(b.fc, b.fr);
      const risky = (L.escape >= 0.9 && danger.has(tk) && !danger.has(fk)) ||
                    (L.avoidEnemy && !danger.has(fk) && ((enemyCore.has(tk) && !enemyCore.has(fk)) || (enemyNear.has(tk) && !enemyNear.has(fk))));
      if ((blocked || risky) && (b.tx !== b.fc || b.ty !== b.fr)) { b.tx = b.fc; b.ty = b.fr; }
      const dx = b.tx - p.x, dy = b.ty - p.y;
      if (Math.abs(dx) + Math.abs(dy) <= s) { p.x = b.tx; p.y = b.ty; }
      else if (Math.abs(dx) > Math.abs(dy)) { p.x += Math.sign(dx) * s; p.dir = dx > 0 ? 'right' : 'left'; }
      else { p.y += Math.sign(dy) * s; p.dir = dy > 0 ? 'down' : 'up'; }
      p.moving = true; p.anim += dt;
      return;
    }
    p.moving = false;
    if (b.wait > 0 && !danger.has(key(...tileOf(p)))) { b.wait -= dt; return; }
    botDecide(p, L);
  }

  // ================= 主要更新 =================
  function updatePlayer(p, dt) {
    if (p.out) return;
    if (!p.alive) {
      p.deathT += dt;
      if (p.deathT > 2.2) {
        if (p.lives > 0) { p.lives--; spawnPlayer(p); p.inv = 2.5; }
        else { p.out = true; checkGameOver(); }
      }
      return;
    }
    if (p.inv > 0) p.inv -= dt;

    if (p.isAI) updateBot(p, dt);
    else {
      const d = currentDir(p);
      p.moving = !!d;
      if (d) {
        p.dir = d;
        moveEntity(p, DIRS[d][0], DIRS[d][1], p.stats.speed * dt, (c, r) => playerCanWalk(p, c, r));
        p.anim += dt;
      }
    }
    if (p.bombReq) { placeBomb(p); p.bombReq = false; }

    // 撿道具
    const pk = key(...tileOf(p)), it = items.get(pk);
    if (it && it !== 'door') {
      items.delete(pk);
      if (it === 'bomb') p.stats.maxBombs = Math.min(p.stats.maxBombs + 1, 8);
      if (it === 'fire') p.stats.range = Math.min(p.stats.range + 1, 8);
      if (it === 'speed') p.stats.speed = Math.min(p.stats.speed + 0.6, 5.6);
      p.score += 50; sfx.item();
      popups.push({ x: p.x, y: p.y, text: it.toUpperCase() + '!', t: 1 });
    }
  }

  function update(dt) {
    stateT += dt;
    if (state === 'stagestart') { if (stateT > 1.8) setState('play'); return; }
    if (state === 'clear') { if (stateT > 3) { stage++; startStage(); } return; }
    if (state !== 'play') return;

    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 200; livePlayers().forEach(p => killPlayer(p, 0)); }

    danger = computeDanger();
    computeEnemyZones();
    for (const p of players) {
      updatePlayer(p, dt);
      if (state !== 'play') return;
    }

    // --- 炸彈 / 火焰 / 燃燒中的磚 ---
    for (const b of [...bombs]) { b.t -= dt; if (b.t <= 0) explode(b); }
    flames = flames.filter(f => (f.t -= dt) > 0);
    burning = burning.filter(b => {
      b.t -= dt;
      if (b.t > 0) return true;
      const k = key(b.c, b.r);
      grid[k] = EMPTY;
      if (hidden.has(k)) { items.set(k, hidden.get(k)); hidden.delete(k); }
      return false;
    });

    // --- 敵人 ---
    danger = computeDanger();
    enemies.forEach(e => updateEnemy(e, dt));
    for (const e of enemies) {
      if (!e.alive) continue;
      const f = flameAt(...tileOf(e));
      if (f) {
        e.alive = false;
        const pts = ENEMY[e.type].pts, owner = players.find(p => p.id === f.owner);
        if (owner) owner.score += pts;
        sfx.kill();
        popups.push({ x: e.x, y: e.y, text: String(pts), t: 1 });
        continue;
      }
      for (const p of livePlayers()) {
        if (p.inv <= 0 && Math.hypot(e.x - p.x, e.y - p.y) < 0.7) killPlayer(p, 0);
      }
    }
    enemies = enemies.filter(e => e.alive || e.deathT < 1.2);

    for (const p of livePlayers()) {
      const f = flameAt(...tileOf(p));
      if (f && p.inv <= 0) killPlayer(p, f.owner);
    }

    popups = popups.filter(p => (p.t -= dt) > 0);

    // --- 過關判定：敵人全滅 + 任一玩家站上出口 ---
    if (enemies.length === 0) {
      for (const p of livePlayers()) {
        const [pc, pr] = tileOf(p);
        if (items.get(key(pc, pr)) === 'door' && Math.hypot(p.x - pc, p.y - pr) < 0.3) {
          clearBy = p;
          p.score += Math.ceil(timeLeft) * 10;
          sfx.clear();
          setState('clear');
          return;
        }
      }
    }
  }

  // ================= 繪圖 =================
  function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
  function circle(x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

  function drawFloor(x, y, c, r) {
    rect(x, y, T, T, (c + r) % 2 ? '#2f8a3a' : '#2b8035');
    const above = r > 0 ? tileAt(c, r - 1) : EMPTY;
    if (above !== EMPTY) rect(x, y, T, 6, 'rgba(0,0,0,.28)');
    const left = c > 0 ? tileAt(c - 1, r) : EMPTY;
    if (left !== EMPTY) rect(x, y, 4, T, 'rgba(0,0,0,.18)');
  }

  function drawWall(x, y) {
    rect(x, y, T, T, '#9a9aa8');
    rect(x, y, T, 3, '#e4e4ee');
    rect(x, y, 3, T, '#d0d0dc');
    rect(x, y + T - 4, T, 4, '#55556a');
    rect(x + T - 4, y, 4, T, '#6a6a80');
    rect(x + 10, y + 10, 12, 12, '#84849a');
    rect(x + 10, y + 10, 12, 2, '#b8b8c8');
  }

  function drawBrick(x, y) {
    rect(x, y, T, T, '#5a2a1e');
    for (let row = 0; row < 4; row++) {
      const oy = y + row * 8, shift = row % 2 ? 8 : 0;
      for (let col = -1; col < 2; col++) {
        const bx = x + col * 16 + shift + 1;
        const x0 = Math.max(bx, x), x1 = Math.min(bx + 14, x + T);
        if (x1 <= x0) continue;
        rect(x0, oy + 1, x1 - x0, 6, '#c0603f');
        rect(x0, oy + 1, x1 - x0, 2, '#e08a63');
      }
    }
  }

  function drawItem(x, y, type) {
    const cx = x + T / 2, cy = y + T / 2;
    if (type === 'door') {
      const lit = enemies.length === 0 && Math.floor(clock * 4) % 2;
      rect(x + 3, y + 3, T - 6, T - 6, '#6d6d7d');
      rect(x + 7, y + 7, T - 14, T - 10, lit ? '#fff176' : '#2a2a3a');
      rect(x + 3, y + 3, T - 6, 3, '#b0b0c0');
      circle(cx + 6, cy + 4, 1.5, lit ? '#000' : '#888');
      return;
    }
    const flash = Math.floor(clock * 6) % 2;
    rect(x + 2, y + 2, T - 4, T - 4, flash ? '#ffcc00' : '#ff8800');
    rect(x + 4, y + 4, T - 8, T - 8, '#1a1a2e');
    if (type === 'bomb') {
      circle(cx, cy + 2, 7, '#111');
      circle(cx - 2, cy, 2, '#888');
      rect(cx + 2, cy - 8, 3, 4, '#c8a060');
      circle(cx + 4, cy - 9, 2, '#ff9800');
    } else if (type === 'fire') {
      ctx.fillStyle = '#ff5722';
      ctx.beginPath(); ctx.moveTo(cx, y + 6); ctx.lineTo(cx + 8, cy + 6); ctx.lineTo(cx - 8, cy + 6); ctx.fill();
      circle(cx, cy + 5, 8, '#ff5722');
      circle(cx, cy + 6, 5, '#ffc107');
      circle(cx, cy + 7, 2.5, '#fff8e1');
    } else if (type === 'speed') {
      rect(cx - 8, cy - 6, 7, 10, '#4fa3ff');
      rect(cx - 8, cy + 2, 16, 5, '#4fa3ff');
      rect(cx - 8, cy + 7, 16, 2, '#ddd');
      circle(cx - 5, cy + 11, 2, '#ffcc00');
      circle(cx + 5, cy + 11, 2, '#ffcc00');
    }
  }

  function drawBomb(b) {
    const cx = b.c * T + T / 2, cy = b.r * T + T / 2 + 2;
    const pulse = 1 + 0.08 * Math.sin((FUSE - b.t) * (8 + (FUSE - b.t) * 6));
    const rad = 11 * pulse;
    circle(cx + 2, cy + 3, rad, 'rgba(0,0,0,.3)');
    circle(cx, cy, rad, b.t < 0.6 && Math.floor(clock * 20) % 2 ? '#7a1010' : '#141414');
    circle(cx - 4, cy - 4, 3, '#ffffff99');
    rect(cx + 4, cy - rad - 3, 3, 5, '#c8a060');
    circle(cx + 6, cy - rad - 4, 2 + Math.random() * 1.5, Math.random() < 0.5 ? '#ffeb3b' : '#ff5722');
  }

  function drawFlame(f) {
    const x = f.c * T, y = f.r * T, cx = x + T / 2, cy = y + T / 2;
    const k = f.t / FLAME_TIME; // 1 → 0
    const base = T * (0.45 + 0.5 * Math.sin(k * Math.PI));
    const layers = [['#ff5722', 1], ['#ffc107', 0.66], ['#fffde7', 0.32]];
    for (const [color, s] of layers) {
      const w = base * s;
      ctx.fillStyle = color;
      if (f.kind === 'center') {
        ctx.fillRect(x, cy - w / 2, T, w);
        ctx.fillRect(cx - w / 2, y, w, T);
        circle(cx, cy, w * 0.7, color);
      } else if (f.kind === 'mid') {
        if (f.dx) ctx.fillRect(x, cy - w / 2, T, w); else ctx.fillRect(cx - w / 2, y, w, T);
      } else { // end：從爆炸中心那側延伸，前端圓頭
        if (f.dx > 0) ctx.fillRect(x, cy - w / 2, T / 2, w);
        if (f.dx < 0) ctx.fillRect(cx, cy - w / 2, T / 2, w);
        if (f.dy > 0) ctx.fillRect(cx - w / 2, y, w, T / 2);
        if (f.dy < 0) ctx.fillRect(cx - w / 2, cy, w, T / 2);
        circle(cx, cy, w / 2, color);
      }
    }
  }

  function drawPlayer(p) {
    const skin = SKINS[p.id];
    let cx = p.x * T + T / 2, cy = p.y * T + T / 2;
    ctx.save();
    if (!p.alive) {
      const k = Math.min(p.deathT / 1.5, 1);
      ctx.translate(cx, cy);
      ctx.rotate(k * Math.PI * 4);
      ctx.scale(1 - k * 0.9, 1 - k * 0.9);
      ctx.translate(-cx, -cy);
      if (Math.floor(p.deathT * 12) % 2) ctx.globalAlpha = 0.5;
    } else if (p.inv > 0 && Math.floor(p.inv * 10) % 2) {
      ctx.globalAlpha = 0.35; // 復活無敵中閃爍
    }
    const step = p.moving ? Math.floor(p.anim * 8) % 2 : 0;
    cy += step ? -1 : 0;
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(cx, p.y * T + T - 3, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
    // 腳
    rect(cx - 8, cy + 9 + (step ? -2 : 0), 7, 5, '#e05a8a');
    rect(cx + 1, cy + 9 + (step ? 0 : -2), 7, 5, '#e05a8a');
    // 身體
    rect(cx - 7, cy + 1, 14, 10, skin.body);
    rect(cx - 7, cy + 6, 14, 2, '#ffcc00');
    // 手
    circle(cx - 9, cy + 5 + (step ? 1 : -1), 3, '#ff9db1');
    circle(cx + 9, cy + 5 + (step ? -1 : 1), 3, '#ff9db1');
    // 頭與天線
    rect(cx - 1, cy - 19, 2, 4, '#555');
    circle(cx, cy - 20, 3, skin.ball);
    circle(cx, cy - 7, 10, skin.head);
    circle(cx - 3, cy - 10, 3, skin.shine);
    if (p.dir !== 'up') {
      const fx = p.dir === 'left' ? -3 : p.dir === 'right' ? 3 : 0;
      rect(cx - 6 + fx, cy - 10, 12, 8, '#f7c6a5');
      rect(cx - 4 + fx, cy - 9, 2, 5, '#111');
      rect(cx + 2 + fx, cy - 9, 2, 5, '#111');
    }
    ctx.restore();
    // 雙人時頭上標示 1P / 2P
    if (players.length > 1 && p.alive) {
      ctx.font = '7px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000'; ctx.fillText(`${p.id}P`, cx + 1, cy - 25);
      ctx.fillStyle = p.id === 1 ? '#4fa3ff' : '#ff4f7b'; ctx.fillText(`${p.id}P`, cx, cy - 26);
    }
  }

  function drawEnemy(e) {
    const def = ENEMY[e.type];
    const cx = e.x * T + T / 2, cy = e.y * T + T / 2 + Math.sin(e.anim * 6) * 1.5;
    ctx.save();
    if (!e.alive) {
      const k = Math.min(e.deathT / 1, 1);
      ctx.globalAlpha = 1 - k;
      ctx.translate(cx, cy); ctx.scale(1 + k * 0.4, 1 - k * 0.6); ctx.translate(-cx, -cy);
    }
    const body = e.alive ? def.color : '#999', dark = e.alive ? def.dark : '#555';
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(cx, e.y * T + T - 3, 10, 3, 0, 0, Math.PI * 2); ctx.fill();

    if (e.type === 'balloom') {
      circle(cx, cy, 12, dark);
      circle(cx, cy - 1, 11, body);
      circle(cx - 4, cy - 6, 3, '#ffffff66');
    } else if (e.type === 'oneal') {
      circle(cx, cy - 2, 11, body);
      rect(cx - 11, cy - 2, 22, 10, body);
      for (let i = 0; i < 4; i++) circle(cx - 8 + i * 5.5, cy + 8 + (Math.floor(e.anim * 8 + i) % 2), 3, body);
    } else {
      rect(cx - 10, cy - 11, 20, 22, body);
      rect(cx - 10, cy + 3, 20, 3, dark);
      rect(cx - 10, cy - 11, 20, 3, '#ffffff55');
    }
    // 眼睛看向移動方向
    const lx = e.dx * 2, ly = e.dy * 2;
    if (e.alive) {
      circle(cx - 4, cy - 3, 3.5, '#fff'); circle(cx + 4, cy - 3, 3.5, '#fff');
      circle(cx - 4 + lx, cy - 3 + ly, 1.8, '#111'); circle(cx + 4 + lx, cy - 3 + ly, 1.8, '#111');
    } else {
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
      for (const ex of [-4, 4]) {
        ctx.beginPath();
        ctx.moveTo(cx + ex - 2, cy - 5); ctx.lineTo(cx + ex + 2, cy - 1);
        ctx.moveTo(cx + ex + 2, cy - 5); ctx.lineTo(cx + ex - 2, cy - 1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * 5), Math.round((Math.random() - 0.5) * 5));

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * T, y = r * T, v = tileAt(c, r);
        if (v === WALL) drawWall(x, y);
        else {
          drawFloor(x, y, c, r);
          if (v === BRICK) drawBrick(x, y);
        }
      }
    }
    // 燃燒中的磚塊
    for (const b of burning) {
      const k = b.t / FLAME_TIME;
      ctx.globalAlpha = k;
      drawBrick(b.c * T, b.r * T);
      ctx.globalAlpha = 0.6 * k * (Math.floor(clock * 20) % 2 ? 1 : 0.5);
      rect(b.c * T, b.r * T, T, T, '#ff7043');
      ctx.globalAlpha = 1;
    }
    for (const [k, type] of items) drawItem((k % COLS) * T, Math.floor(k / COLS) * T, type);
    bombs.forEach(drawBomb);
    flames.forEach(drawFlame);
    enemies.forEach(drawEnemy);
    if (state !== 'title') players.filter(p => !p.out).forEach(drawPlayer);

    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    for (const p of popups) {
      const px = p.x * T + T / 2, py = p.y * T - (1 - p.t) * 20;
      ctx.fillStyle = '#000'; ctx.fillText(p.text, px + 1, py + 1);
      ctx.fillStyle = '#fff'; ctx.fillText(p.text, px, py);
    }
    ctx.restore();
  }

  // ================= HUD =================
  let hudCache = '';
  function updateHud() {
    const pv = players.map(p => [p.score, p.lives, p.stats.maxBombs, p.stats.range, p.out]);
    const sig = JSON.stringify([stage, Math.ceil(timeLeft), aiLevel, pv]);
    if (sig === hudCache) return;
    hudCache = sig;
    ui.stage.textContent = stage;
    ui.time.textContent = Math.ceil(timeLeft);
    ui.ai.textContent = aiLevel;
    for (const id of [1, 2]) {
      const p = players.find(q => q.id === id);
      if (!p) continue;
      $(`hud-score${id}`).textContent = String(p.score).padStart(6, '0');
      $(`hud-lives${id}`).textContent = p.lives;
      $(`hud-bombs${id}`).textContent = p.stats.maxBombs;
      $(`hud-fire${id}`).textContent = p.stats.range;
      $(`hud-score${id}`).parentElement.classList.toggle('out', p.out);
    }
  }

  // ================= 輸入：鍵盤 =================
  const held = { 1: [], 2: [] };
  const KEYMAP = {
    ArrowUp: [1, 'up'], KeyW: [1, 'up'], ArrowDown: [1, 'down'], KeyS: [1, 'down'],
    ArrowLeft: [1, 'left'], KeyA: [1, 'left'], ArrowRight: [1, 'right'], KeyD: [1, 'right'],
    KeyI: [2, 'up'], KeyK: [2, 'down'], KeyJ: [2, 'left'], KeyL: [2, 'right'],
  };
  const P2_ORDER = ['off', 'ai', 'human'];

  function currentDir(p) {
    const h = held[p.id];
    return (p.id === 1 && touchDir) || h[h.length - 1] || null;
  }

  window.addEventListener('keydown', e => {
    const m = KEYMAP[e.code], d = m && m[1];
    if (state === 'title' || state === 'paused' || state === 'gameover') {
      const num = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
      if (num) { audio(); setAiLevel(+num[1]); return; }
      if (m && m[0] === 1 && (d === 'left' || d === 'right')) {
        e.preventDefault(); audio();
        if (!e.repeat) setAiLevel(aiLevel + (d === 'right' ? 1 : -1));
        return;
      }
      if (m && m[0] === 1 && state !== 'paused' && (d === 'up' || d === 'down')) {
        e.preventDefault(); audio();
        if (!e.repeat) {
          const options = P2_ORDER.filter(o => !(isTouch && o === 'human'));
          const i = options.indexOf(p2Mode);
          setP2Mode(options[(i + (d === 'down' ? 1 : -1) + options.length) % options.length]);
        }
        return;
      }
    }
    if (m) { if (!held[m[0]].includes(d)) held[m[0]].push(d); e.preventDefault(); return; }
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'KeyX') { e.preventDefault(); action(); }
    else if (e.code === 'KeyU' || e.code === 'KeyO') {
      const p2 = players[1];
      if (state === 'play' && p2 && !p2.isAI) p2.bombReq = true;
    }
    else if (e.code === 'Enter') { e.preventDefault(); audio(); if (state === 'title' || state === 'gameover') startGame(); else togglePause(); }
    else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  });
  window.addEventListener('keyup', e => {
    const m = KEYMAP[e.code];
    if (m) { const h = held[m[0]], i = h.indexOf(m[1]); if (i >= 0) h.splice(i, 1); }
  });
  window.addEventListener('blur', () => { held[1].length = 0; held[2].length = 0; touchDir = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') setState('paused'); });

  // ================= 輸入：觸控 =================
  let touchDir = null;
  const pad = $('dpad');
  const arrows = pad.querySelectorAll('.arrow');
  function padDir(e) {
    const r = pad.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(x, y) < r.width * 0.12) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  }
  function setTouchDir(d) {
    touchDir = d;
    arrows.forEach(a => a.classList.toggle('active', a.dataset.dir === d));
  }
  let padPointer = null;
  pad.addEventListener('pointerdown', e => {
    e.preventDefault(); audio();
    padPointer = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    setTouchDir(padDir(e));
  });
  pad.addEventListener('pointermove', e => { if (e.pointerId === padPointer) setTouchDir(padDir(e)); });
  const padEnd = e => { if (e.pointerId === padPointer) { padPointer = null; setTouchDir(null); } };
  pad.addEventListener('pointerup', padEnd);
  pad.addEventListener('pointercancel', padEnd);

  $('btn-bomb').addEventListener('pointerdown', e => { e.preventDefault(); action(); });
  $('btn-pause').addEventListener('pointerdown', e => { e.preventDefault(); audio(); togglePause(); });
  ui.aiButtons.forEach(b => b.addEventListener('pointerdown', e => {
    e.preventDefault(); audio();
    setAiLevel(+b.dataset.lv);
  }));
  ui.p2Buttons.forEach(b => b.addEventListener('pointerdown', e => {
    e.preventDefault(); audio();
    setP2Mode(b.dataset.mode);
  }));
  ui.overlay.addEventListener('pointerdown', e => {
    if (e.target.closest('.ai-select')) return; // 點選設定不觸發開始
    e.preventDefault(); audio();
    if (state === 'title' || state === 'gameover') startGame();
    else if (state === 'paused') setState('play');
  });

  // ================= 主迴圈 =================
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state !== 'paused') { clock += dt; update(dt); }
    if (shake > 0) shake -= dt;
    draw();
    updateHud();
    requestAnimationFrame(frame);
  }

  setAiLevel(aiLevel);
  setP2Mode(p2Mode);
  ui.p2.classList.toggle('hidden', p2Mode === 'off');
  buildStage();       // 標題畫面背景用
  setState('title');
  requestAnimationFrame(frame);
})();
