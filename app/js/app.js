// Do Outro Lado: the screen. Holds one match per game, runs the turns and asks the server for Claude's move.

import { api } from './api.js';
import chess from './games/chess.js';
import checkers from './games/checkers.js';
import tictactoe from './games/tictactoe.js';
import connect4 from './games/connect4.js';
import reversi from './games/reversi.js';
import cards from './games/cards.js';

const GAMES = [chess, checkers, tictactoe, connect4, reversi, cards];
const BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));
const LEVELS = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };
// What each level tells Claude (the model is the same for all of them; see server/ai.py).
const STYLE_NOTES = { easy: 'joga como iniciante e erra de propósito', medium: 'joga como amador, erra de vez em quando', hard: 'joga o melhor que consegue' };
const EFFORTS = { low: 'baixo', medium: 'médio', high: 'alto', xhigh: 'muito alto', max: 'máximo' };
const STARTER_NOTES = {
  chess: 'quem começa joga de brancas',
  checkers: 'quem começa joga de brancas',
  reversi: 'quem começa joga de escuras',
  tictactoe: 'quem começa joga de X',
  connect4: '',
  cards: '',
};
const ICONS = {
  chess: '<svg viewBox="0 0 24 24"><circle cx="12" cy="6.5" r="2.5"/><path d="M9.5 20 10.5 10h3l1 10M8 20h8M9.5 10h5"/></svg>',
  checkers: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="9" rx="7" ry="3"/><path d="M5 9v4c0 1.7 3.1 3 7 3s7-1.3 7-3V9"/><path d="M5 13v3c0 1.7 3.1 3 7 3s7-1.3 7-3v-3"/></svg>',
  tictactoe: '<svg viewBox="0 0 24 24"><path d="M9 4v16M15 4v16M4 9h16M4 15h16"/><path d="m5.5 5.5 2 2m0-2-2 2"/><circle cx="18" cy="18" r="1.4"/></svg>',
  connect4: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><circle cx="15.5" cy="9" r="1.6"/><circle cx="8.5" cy="15" r="1.6"/><circle cx="15.5" cy="15" r="1.6"/></svg>',
  reversi: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15Z" fill="currentColor"/></svg>',
  cards: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="10" height="14" rx="2" transform="rotate(-10 9 13)"/><rect x="10" y="4" width="10" height="14" rx="2"/></svg>',
};

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 3 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = {
  get(key, fallback) {
    try { return localStorage.getItem(`mesa.${key}`) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`mesa.${key}`, value); } catch { /* sem armazenamento: só não lembra */ }
  },
};

let server = null; // /api/state
let current = BY_ID[store.get('game', 'chess')] ? store.get('game', 'chess') : 'chess';
let difficulty = LEVELS[store.get('difficulty', 'medium')] ? store.get('difficulty', 'medium') : 'medium';
let starter = store.get('starter', 'human') === 'claude' ? 'claude' : 'human';
const sessions = {};
let ticker = null;

// ── Matches ─────────────────────────────────────────────────────────────────

function newSession(gameId) {
  const game = BY_ID[gameId];
  return { state: game.create(starter === 'human'), log: [], cost: 0, busy: false, error: null, local: {},
    token: {}, thinkingSince: 0, thinkingWith: null, started: starter, last: null };
}

function session(gameId = current) {
  if (!sessions[gameId]) sessions[gameId] = newSession(gameId);
  return sessions[gameId];
}

function modelName(id) {
  const m = server?.models.find((x) => x.id === id);
  return (m ? m.name : id || '').replace(/^Claude /, '');
}

function levelModel(level = difficulty) {
  if (!server) return { model: '', effort: '' };
  return { model: server.config.model, effort: level === 'hard' ? server.config.effort_hard : server.config.effort };
}

function record(s, game, who, move, info = {}) {
  let note = '';
  if (who === 'claude') {
    if (info.forced) note = 'lance único';
    else if (info.random) note = `${modelName(info.model)}: a IA não escolheu, lance aleatório`;
    else if (info.model) note = modelName(info.model) + (info.replaced ? ' (reserva, sem crédito no principal)' : '');
    if (info.level && !info.forced) note += `${note ? ', ' : ''}nível ${LEVELS[info.level].toLowerCase()}`;
  }
  s.log.push({ who, text: game.notation(s.state, move), note });
}

function humanMove(id) {
  const gameId = current;
  const s = session(gameId);
  const game = BY_ID[gameId];
  if (s.busy || game.outcome(s.state) || s.state.turn !== 'human') return;
  if (!game.moves(s.state).includes(id)) return;
  record(s, game, 'human', id);
  s.state = game.play(s.state, id);
  render();
  advance(gameId);
}

async function advance(gameId) {
  const s = session(gameId);
  if (s.running) return; // one turn loop per match
  s.running = true;
  try {
    await claudeTurns(gameId, s);
  } finally {
    s.running = false;
  }
  // A move that arrived while the loop was closing still gets its answer.
  if (sessions[gameId] === s && !s.error && !BY_ID[gameId].outcome(s.state) && s.state.turn === 'claude') advance(gameId);
}

async function claudeTurns(gameId, s) {
  const game = BY_ID[gameId];
  const token = s.token;
  while (!game.outcome(s.state) && s.state.turn === 'claude') {
    const moves = game.moves(s.state);
    const level = difficulty;
    let res;
    s.error = null;
    if (moves.length === 1) {
      s.busy = true;
      s.thinkingSince = Date.now();
      s.thinkingWith = null;
      render();
      await sleep(450);
      res = { move: moves[0], forced: true, cost: 0 };
    } else {
      s.busy = true;
      s.thinkingSince = Date.now();
      s.thinkingWith = levelModel(level);
      render();
      try {
        res = await api('move', { method: 'POST', body: { game: gameId, difficulty: level, position: game.describe(s.state), moves } });
      } catch (e) {
        if (token !== s.token) return;
        s.busy = false;
        s.error = e.message || 'Erro desconhecido.';
        render();
        return;
      }
    }
    if (token !== s.token) return; // a new match started meanwhile
    s.busy = false;
    if (!moves.includes(res.move)) {
      s.error = 'O servidor devolveu um lance que não está na lista.';
      render();
      return;
    }
    record(s, game, 'claude', res.move, { ...res, level });
    s.cost += Number(res.cost) || 0;
    s.state = game.play(s.state, res.move);
    render();
  }
}

function startNew(gameId = current) {
  if (sessions[gameId]) sessions[gameId].token = null;
  sessions[gameId] = newSession(gameId);
  render();
  advance(gameId);
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function renderRail() {
  const list = $('gameList');
  list.innerHTML = '';
  for (const game of GAMES) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'game-link';
    b.innerHTML = `${ICONS[game.id]}<span>${game.name}</span>`;
    if (game.id === current) b.setAttribute('aria-current', 'page');
    if (sessions[game.id]?.busy) {
      const dot = document.createElement('span');
      dot.className = 'live';
      dot.title = 'O Claude está pensando nesta partida';
      b.appendChild(dot);
    }
    b.addEventListener('click', () => {
      current = game.id;
      store.set('game', current);
      render();
      advance(current);
    });
    li.appendChild(b);
    list.appendChild(li);
  }
}

function setSegmented(group, value) {
  for (const b of $(group).querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === value));
}

function decorateSquares(root) {
  // Coordinates and move hints as real elements (the square's own pseudo-elements stay free).
  for (const sq of root.querySelectorAll('.sq')) {
    if (sq.dataset.rank) sq.insertAdjacentHTML('beforeend', `<span class="sq-coord rank">${sq.dataset.rank}</span>`);
    if (sq.dataset.file) sq.insertAdjacentHTML('beforeend', `<span class="sq-coord file">${sq.dataset.file}</span>`);
    if (sq.classList.contains('is-target') || sq.classList.contains('is-capture')) {
      sq.insertAdjacentHTML('beforeend', '<span class="sq-hint"></span>');
    }
  }
}

function renderStage() {
  const s = session();
  const game = BY_ID[current];
  const stage = $('stage');
  const result = game.outcome(s.state);
  const canAct = !result && !s.busy && s.state.turn === 'human';
  const ui = { canAct, local: s.local, onMove: humanMove, redraw: renderStage };
  stage.innerHTML = '';
  if (result) {
    const banner = document.createElement('div');
    banner.className = 'result';
    const title = result.winner === 'draw' ? 'Empate' : result.winner === 'human' ? 'Você venceu' : 'O Claude venceu';
    banner.innerHTML = `<span>${title}</span><small>${result.reason}</small>`;
    stage.appendChild(banner);
  }
  const board = document.createElement('div');
  board.className = 'board-wrap';
  board.style.display = 'contents';
  stage.appendChild(board);
  game.render(board, s.state, ui);
  decorateSquares(board);
  stage.classList.toggle('has-extra', Boolean(result || board.querySelector('.promo, .board-action')));
}

function renderSeats() {
  const s = session();
  const game = BY_ID[current];
  const result = game.outcome(s.state);
  const seatClaude = $('seatClaude');
  const seatYou = $('seatYou');
  const status = $('claudeStatus');
  seatClaude.classList.toggle('is-thinking', s.busy);
  seatClaude.classList.toggle('is-turn', !result && s.state.turn === 'claude');
  seatYou.classList.toggle('is-turn', !result && s.state.turn === 'human' && !s.busy);

  clearInterval(ticker);
  const cost = s.cost ? `${money.format(s.cost)} nesta partida` : '';
  $('claudeCost').textContent = cost;

  if (s.busy) {
    const tick = () => {
      const secs = Math.floor((Date.now() - s.thinkingSince) / 1000);
      const who = s.thinkingWith
        ? `${modelName(s.thinkingWith.model)}, esforço ${EFFORTS[s.thinkingWith.effort] || s.thinkingWith.effort}, ${secs} s`
        : 'só tem um lance possível';
      status.innerHTML = `Claude está pensando. <span class="quiet">${who}</span>`;
    };
    tick();
    if (s.thinkingWith) ticker = setInterval(tick, 1000);
  } else if (s.error) {
    status.innerHTML = '';
    const err = document.createElement('span');
    err.className = 'err';
    err.textContent = s.error;
    status.appendChild(err);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn';
    retry.textContent = 'Tentar de novo';
    retry.addEventListener('click', () => advance(current));
    $('claudeCost').textContent = '';
    $('claudeCost').append(retry, cost ? ` ${cost}` : '');
  } else {
    const last = [...s.log].reverse().find((l) => l.who === 'claude');
    status.innerHTML = last ? `Jogou ${escapeHtml(last.text)}. <span class="quiet">${escapeHtml(last.note)}</span>` : '<span class="quiet">Esperando o primeiro lance.</span>';
  }

  const you = $('youStatus');
  if (result) you.textContent = result.winner === 'human' ? 'Você venceu.' : result.winner === 'draw' ? 'Empate.' : 'Você perdeu.';
  else if (s.state.turn === 'human' && !s.busy) you.textContent = yourTurnText(game, s.state);
  else you.innerHTML = '<span class="quiet">Vez do Claude.</span>';

  const actions = $('seatActions');
  actions.innerHTML = '';
  if (result) {
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn btn-primary';
    again.textContent = 'Jogar de novo';
    again.addEventListener('click', () => startNew());
    actions.appendChild(again);
  }
}

function yourTurnText(game, state) {
  if (game.id === 'chess') return state.history.length ? 'Sua vez.' : 'Sua vez. Clique numa peça e depois na casa.';
  if (game.id === 'checkers') return 'Sua vez. Clique na peça e depois em cada casa do caminho.';
  if (game.id === 'cards') return state.phase === 'drawn' ? 'Você comprou: jogue a carta marcada ou passe a vez.' : 'Sua vez. Jogue uma carta levantada ou compre do monte.';
  if (game.id === 'connect4') return 'Sua vez. Clique numa coluna.';
  return 'Sua vez.';
}

function renderSheet() {
  const s = session();
  const game = BY_ID[current];
  const sheet = $('sheet');
  sheet.innerHTML = '';
  const level = LEVELS[difficulty];
  const { model, effort } = levelModel();
  $('sheetMeta').textContent = `${game.name}. Começou: ${s.started === 'human' ? 'você' : 'Claude'}. Nível ${level.toLowerCase()} agora${model ? ` (${modelName(model)}, esforço ${EFFORTS[effort] || effort})` : ''}.`;
  if (!s.log.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nenhum lance ainda.';
    sheet.appendChild(li);
    return;
  }
  s.log.forEach((entry, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="n">${i + 1}.</span><span class="who" data-who="${entry.who}">${entry.who === 'human' ? 'Você' : 'Claude'}</span><span class="what">${escapeHtml(entry.text)}${entry.note ? `<small>${escapeHtml(entry.note)}</small>` : ''}</span>`;
    sheet.appendChild(li);
  });
  sheet.scrollTop = sheet.scrollHeight;
}

function renderTop() {
  const game = BY_ID[current];
  $('gameName').textContent = game.name;
  $('gameBlurb').textContent = game.blurb;
  document.title = `${game.name} · Do Outro Lado`;
  setSegmented('difficulty', difficulty);
  setSegmented('starter', starter);
  $('diffNote').textContent = STYLE_NOTES[difficulty];
  $('starterNote').textContent = STARTER_NOTES[current] || '';
}

function render() {
  renderRail();
  renderTop();
  renderStage();
  renderSeats();
  renderSheet();
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Settings ────────────────────────────────────────────────────────────────

function renderSettings() {
  if (!server) return;
  for (const form of document.querySelectorAll('.key-row')) {
    const name = form.dataset.key;
    const end = server.keys[name];
    const state = form.querySelector('.key-state');
    state.textContent = end ? `Guardada (termina em ${end.replace('…', '')})` : 'Nenhuma guardada';
    state.classList.toggle('ok', Boolean(end));
  }
  const model = $('model');
  model.innerHTML = '';
  for (const m of server.models) model.add(new Option(m.name, m.id, false, m.id === server.config.model));
  if (!server.models.some((m) => m.id === server.config.model)) {
    model.add(new Option(server.config.model, server.config.model, false, true));
  }
  for (const [id, key] of [['effort', 'effort'], ['effortHard', 'effort_hard']]) {
    const effort = $(id);
    effort.innerHTML = '';
    for (const e of server.efforts) effort.add(new Option(`esforço ${EFFORTS[e] || e}`, e, false, e === server.config[key]));
  }
  const fb = $('fallback');
  fb.innerHTML = '';
  fb.add(new Option('Automática (o par do outro lado)', 'auto'));
  fb.add(new Option('Nenhuma', 'nenhuma'));
  for (const m of server.models) fb.add(new Option(m.name, m.id));
  fb.value = server.config.fallback;
  $('versionLine').textContent = `Versão ${server.version}${server.dev ? ' (cópia de desenvolvimento, atualiza pelo git)' : ''}.`;
}

async function saveConfig(changes) {
  try {
    server = await api('config', { method: 'POST', body: changes });
    renderSettings();
    render();
  } catch (e) {
    $('updateLine').textContent = e.message;
  }
}

function wireSettings() {
  const drawer = $('settings');
  $('openSettings').addEventListener('click', () => {
    renderSettings();
    drawer.hidden = false;
    drawer.querySelector('input')?.focus();
  });
  const close = () => {
    drawer.hidden = true;
    $('openSettings').focus();
  };
  $('closeSettings').addEventListener('click', close);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !drawer.hidden) close(); });
  $('fallback').addEventListener('change', (ev) => saveConfig({ fallback: ev.target.value }));
  $('model').addEventListener('change', (ev) => saveConfig({ model: ev.target.value }));
  $('effort').addEventListener('change', (ev) => saveConfig({ effort: ev.target.value }));
  $('effortHard').addEventListener('change', (ev) => saveConfig({ effort_hard: ev.target.value }));
  for (const form of document.querySelectorAll('.key-row')) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = form.querySelector('input');
      const state = form.querySelector('.key-state');
      try {
        server = await api('key', { method: 'POST', body: { name: form.dataset.key, value: input.value } });
        input.value = '';
        renderSettings();
      } catch (e) {
        state.textContent = e.message;
      }
    });
  }
  $('checkUpdate').addEventListener('click', async () => {
    const line = $('updateLine');
    line.textContent = 'Procurando...';
    $('applyUpdate').hidden = true;
    try {
      const info = await api('update?force=1');
      if (info.erro) line.textContent = info.erro;
      else if (info.nova) {
        line.textContent = `Versão ${info.ultima} disponível (você está na ${info.atual}).`;
        $('applyUpdate').hidden = Boolean(info.dev);
      } else line.textContent = `Você já está na versão mais nova (${info.atual}).`;
    } catch (e) {
      line.textContent = e.message;
    }
  });
  $('applyUpdate').addEventListener('click', async () => {
    const line = $('updateLine');
    try {
      line.textContent = 'Baixando...';
      await api('update/download', { method: 'POST' });
      line.textContent = 'Reiniciando...';
      await api('update/restart', { method: 'POST' });
      for (let i = 0; i < 40; i++) {
        await sleep(1000);
        try { await api('state'); location.reload(); return; } catch { /* ainda subindo */ }
      }
      line.textContent = 'O app não voltou sozinho. Feche e abra de novo.';
    } catch (e) {
      line.textContent = e.message;
    }
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

function wireControls() {
  for (const b of $('difficulty').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      difficulty = b.dataset.value;
      store.set('difficulty', difficulty);
      render();
    });
  }
  for (const b of $('starter').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      starter = b.dataset.value;
      store.set('starter', starter);
      renderTop();
    });
  }
  $('newGame').addEventListener('click', () => startNew());
}

async function boot() {
  wireControls();
  wireSettings();
  try {
    server = await api('state');
  } catch (e) {
    server = null;
  }
  render();
  advance(current);
  if (server && !server.keys.claude && !server.keys.openai) {
    $('claudeStatus').innerHTML = '<span class="err">Falta a chave da Anthropic.</span> <span class="quiet">Abra Configurações e cole a chave para o Claude jogar.</span>';
  }
}

boot();
