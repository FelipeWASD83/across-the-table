// Chess with chess.js (vendor/chess.js, BSD-2) for the rules. Claude gets FEN, a drawing, the move list and the
// legal moves in SAN. The person always sits at the bottom; whoever starts plays white.

import { Chess } from '../../vendor/chess.js';
import { PIECES } from './chess-pieces.js';

const games = new WeakMap(); // state -> Chess instance with the full history (for repetition)
const other = (who) => (who === 'human' ? 'claude' : 'human');

function engine(state) {
  let g = games.get(state);
  if (!g) {
    g = new Chess();
    for (const san of state.history) g.move(san);
    games.set(state, g);
  }
  return g;
}

function colorOf(state, who) {
  return state.white === who ? 'w' : 'b';
}

export default {
  id: 'chess',
  name: 'Xadrez',
  blurb: 'Regras completas: roque, en passant, promoção e empates.',
  pieces: { human: 'Peças', claude: 'Peças' },

  create(humanFirst) {
    return { history: [], white: humanFirst ? 'human' : 'claude', turn: humanFirst ? 'human' : 'claude', last: null };
  },

  moves(state) {
    if (this.outcome(state)) return [];
    return engine(state).moves();
  },

  play(state, san) {
    // The engine moves on to the new state; the old one rebuilds its own if it is ever asked again.
    const g = engine(state);
    games.delete(state);
    const move = g.move(san);
    const next = { ...state, history: [...state.history, move.san], turn: other(state.turn),
      last: { from: move.from, to: move.to } };
    games.set(next, g);
    return next;
  },

  notation(state, san) {
    return san;
  },

  outcome(state) {
    const g = engine(state);
    if (g.isCheckmate()) return { winner: other(state.turn), reason: 'xeque-mate' };
    if (g.isStalemate()) return { winner: 'draw', reason: 'afogamento' };
    if (g.isInsufficientMaterial()) return { winner: 'draw', reason: 'material insuficiente' };
    if (g.isThreefoldRepetition()) return { winner: 'draw', reason: 'repetição tripla' };
    if (g.isDrawByFiftyMoves()) return { winner: 'draw', reason: 'regra dos 50 lances' };
    return null;
  },

  describe(state) {
    const g = engine(state);
    const mine = colorOf(state, 'claude') === 'w' ? 'White' : 'Black';
    const pairs = [];
    for (let i = 0; i < state.history.length; i += 2) {
      pairs.push(`${i / 2 + 1}. ${state.history[i]}${state.history[i + 1] ? ' ' + state.history[i + 1] : ''}`);
    }
    const check = g.inCheck() ? '\nYou are in check.' : '';
    return `You play ${mine}; it is your move.${check}\n\nFEN: ${g.fen()}\n\n${g.ascii()}\nMoves so far: ${pairs.join(' ') || '(none, this is the first move)'}`;
  },

  render(el, state, ui) {
    const g = engine(state);
    const local = ui.local;
    if (local.state !== state) {
      local.state = state;
      local.from = null;
      local.promo = null;
    }
    const verbose = ui.canAct ? g.moves({ verbose: true }) : [];
    const fromSquares = new Set(verbose.map((m) => m.from));
    const targets = local.from ? verbose.filter((m) => m.from === local.from) : [];
    const targetSquares = new Set(targets.map((m) => m.to));
    const flip = state.white === 'claude';
    const files = 'abcdefgh';
    const checkSquare = g.inCheck() ? findKing(g, g.turn()) : null;

    el.innerHTML = '';
    const board = document.createElement('div');
    board.className = 'grid8 chess';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const rank = flip ? row + 1 : 8 - row;
        const file = flip ? 7 - col : col;
        const name = files[file] + rank;
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'sq';
        cell.dataset.shade = (file + rank) % 2 === 0 ? 'light' : 'dark';
        const piece = g.get(name);
        cell.setAttribute('aria-label', piece ? `${name}, ${PIECE_NAMES[piece.type]}` : name);
        if (piece) cell.innerHTML = PIECES[piece.type](piece.color);
        if (state.last && (state.last.from === name || state.last.to === name)) cell.classList.add('is-last');
        if (checkSquare === name) cell.classList.add('is-check');
        if (local.from === name) cell.classList.add('is-selected');
        let action = null;
        if (targetSquares.has(name)) {
          cell.classList.add(piece ? 'is-capture' : 'is-target');
          action = () => {
            const options = targets.filter((m) => m.to === name);
            if (options.length > 1) {
              local.promo = options;
              return ui.redraw();
            }
            ui.onMove(options[0].san);
          };
        } else if (fromSquares.has(name)) {
          cell.classList.add('is-movable');
          action = () => {
            local.from = local.from === name ? null : name;
            local.promo = null;
            ui.redraw();
          };
        }
        if (action) cell.addEventListener('click', action);
        else cell.disabled = true;
        if (col === 0) cell.dataset.rank = rank;
        if (row === 7) cell.dataset.file = files[file];
        board.appendChild(cell);
      }
    }
    el.appendChild(board);

    if (local.promo) {
      const bar = document.createElement('div');
      bar.className = 'promo';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Promover o peão para');
      const label = document.createElement('span');
      label.textContent = 'Promover para';
      bar.appendChild(label);
      for (const m of local.promo) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'promo-piece';
        b.title = PIECE_NAMES[m.promotion];
        b.setAttribute('aria-label', PIECE_NAMES[m.promotion]);
        b.innerHTML = PIECES[m.promotion](m.color);
        b.addEventListener('click', () => ui.onMove(m.san));
        bar.appendChild(b);
      }
      el.appendChild(bar);
    }
  },
};

const PIECE_NAMES = { p: 'peão', n: 'cavalo', b: 'bispo', r: 'torre', q: 'dama', k: 'rei' };

function findKing(g, color) {
  for (const row of g.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}
