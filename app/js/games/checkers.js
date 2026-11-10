// Brazilian checkers (damas brasileiras): 8x8, men capture backwards too, capture is mandatory and the
// sequence that takes the most pieces must be played (no preference for kings), flying kings, and a man is
// crowned only when the move ends on the far row. Captured pieces stay on the board until the move ends,
// so they cannot be jumped twice and they still block the way.
//
// Squares a1..h8, rank 1 at the bottom. The person always sits at the bottom (ranks 1-3); whoever starts plays
// white. Moves: "c3-d4", "f2-b6" (king), captures with every landing square: "c3xe5xg7".

const N = 8;
const DIAGS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
export const DRAW_PLIES = 40; // 20 moves each with only kings moving and no capture
const sq = (f, r) => 'abcdefgh'[f] + (r + 1);
const parse = (s) => ['abcdefgh'.indexOf(s[0]), Number(s.slice(1)) - 1];
const inside = (f, r) => f >= 0 && f < N && r >= 0 && r < N;
const other = (who) => (who === 'human' ? 'claude' : 'human');
const forward = (who) => (who === 'human' ? 1 : -1);

function initialBoard() {
  const board = Array.from({ length: N }, () => Array(N).fill(null));
  for (let r = 0; r < N; r++) {
    for (let f = 0; f < N; f++) {
      if ((f + r) % 2 !== 0) continue;
      if (r <= 2) board[r][f] = { who: 'human', king: false };
      if (r >= 5) board[r][f] = { who: 'claude', king: false };
    }
  }
  return board;
}

// Every capture sequence from (f, r). Returns arrays of {path:[squares], taken:[squares]}.
function captures(board, f, r, piece) {
  const results = [];
  const walk = (cf, cr, path, taken) => {
    let extended = false;
    for (const [df, dr] of DIAGS) {
      if (piece.king) {
        let tf = cf + df;
        let tr = cr + dr;
        while (inside(tf, tr) && !board[tr][tf]) { tf += df; tr += dr; }
        if (!inside(tf, tr)) continue;
        const target = board[tr][tf];
        const targetName = sq(tf, tr);
        if (target.who === piece.who || taken.includes(targetName)) continue;
        let lf = tf + df;
        let lr = tr + dr;
        while (inside(lf, lr) && !board[lr][lf]) {
          extended = true;
          walk(lf, lr, [...path, sq(lf, lr)], [...taken, targetName]);
          lf += df;
          lr += dr;
        }
      } else {
        const tf = cf + df;
        const tr = cr + dr;
        const lf = cf + 2 * df;
        const lr = cr + 2 * dr;
        if (!inside(lf, lr)) continue;
        const target = board[tr][tf];
        const targetName = sq(tf, tr);
        if (!target || target.who === piece.who || taken.includes(targetName) || board[lr][lf]) continue;
        extended = true;
        walk(lf, lr, [...path, sq(lf, lr)], [...taken, targetName]);
      }
    }
    if (!extended && taken.length) results.push({ path, taken });
  };
  // The moving piece leaves its square: it does not block itself.
  const saved = board[r][f];
  board[r][f] = null;
  walk(f, r, [sq(f, r)], []);
  board[r][f] = saved;
  return results;
}

function simpleMoves(board, f, r, piece) {
  const out = [];
  for (const [df, dr] of DIAGS) {
    if (!piece.king && dr !== forward(piece.who)) continue;
    let tf = f + df;
    let tr = r + dr;
    while (inside(tf, tr) && !board[tr][tf]) {
      out.push({ path: [sq(f, r), sq(tf, tr)], taken: [] });
      if (!piece.king) break;
      tf += df;
      tr += dr;
    }
  }
  return out;
}

export function legalSequences(board, who) {
  let caps = [];
  const simple = [];
  for (let r = 0; r < N; r++) {
    for (let f = 0; f < N; f++) {
      const piece = board[r][f];
      if (!piece || piece.who !== who) continue;
      caps.push(...captures(board, f, r, piece));
      simple.push(...simpleMoves(board, f, r, piece));
    }
  }
  if (caps.length) {
    const most = Math.max(...caps.map((c) => c.taken.length));
    caps = caps.filter((c) => c.taken.length === most);
    return caps.map((c) => ({ ...c, id: c.path.join('x') }));
  }
  return simple.map((m) => ({ ...m, id: m.path.join('-') }));
}

function counts(board) {
  const out = { human: { men: 0, kings: 0 }, claude: { men: 0, kings: 0 } };
  for (const row of board) for (const p of row) if (p) out[p.who][p.king ? 'kings' : 'men']++;
  return out;
}

export default {
  id: 'checkers',
  name: 'Damas',
  blurb: 'Regra brasileira: captura obrigatória, lei da maioria e dama que voa.',
  pieces: { human: 'Peças', claude: 'Peças' },

  create(humanFirst) {
    return { board: initialBoard(), turn: humanFirst ? 'human' : 'claude', white: humanFirst ? 'human' : 'claude',
      last: null, quiet: 0 };
  },

  sequences(state) {
    if (this.outcome(state)) return [];
    return legalSequences(state.board, state.turn);
  },

  moves(state) {
    return this.sequences(state).map((s) => s.id);
  },

  play(state, id) {
    const seq = legalSequences(state.board, state.turn).find((s) => s.id === id);
    if (!seq) throw new Error(`Lance ilegal nas damas: ${id}`);
    const board = state.board.map((row) => row.map((p) => (p ? { ...p } : null)));
    const [ff, fr] = parse(seq.path[0]);
    const [tf, tr] = parse(seq.path[seq.path.length - 1]);
    const piece = board[fr][ff];
    board[fr][ff] = null;
    for (const t of seq.taken) {
      const [cf, cr] = parse(t);
      board[cr][cf] = null;
    }
    const lastRank = piece.who === 'human' ? N - 1 : 0;
    const wasKing = piece.king;
    if (!piece.king && tr === lastRank) piece.king = true;
    board[tr][tf] = piece;
    const quiet = wasKing && !seq.taken.length ? state.quiet + 1 : 0;
    return { ...state, board, turn: other(state.turn), last: { path: seq.path, taken: seq.taken }, quiet };
  },

  notation(state, id) {
    return id;
  },

  outcome(state) {
    const c = counts(state.board);
    if (!c.human.men && !c.human.kings) return { winner: 'claude', reason: 'sem peças' };
    if (!c.claude.men && !c.claude.kings) return { winner: 'human', reason: 'sem peças' };
    if (!legalSequences(state.board, state.turn).length) {
      return { winner: other(state.turn), reason: 'sem lance possível' };
    }
    if (state.quiet >= DRAW_PLIES) return { winner: 'draw', reason: '20 lances de damas sem captura' };
    return null;
  },

  describe(state) {
    const mark = (p) => {
      if (!p) return '.';
      const ch = p.who === 'claude' ? 'c' : 'p';
      return p.king ? ch.toUpperCase() : ch;
    };
    const rows = [];
    for (let r = N - 1; r >= 0; r--) rows.push(`${r + 1} ${state.board[r].map(mark).join(' ')}`);
    const c = counts(state.board);
    const quiet = state.quiet ? `\nKing moves in a row without a capture: ${state.quiet} of ${DRAW_PLIES} (then it is a draw).` : '';
    return `You are c (men) and C (kings); the person is p and P. Your men move down the board, toward rank 1, and are crowned on rank 1. The person's men move up and are crowned on rank 8. Dots are empty squares.\n\n${rows.join('\n')}\n  a b c d e f g h\n\nYou have ${c.claude.men} men and ${c.claude.kings} kings; the person has ${c.human.men} men and ${c.human.kings} kings.${quiet}`;
  },

  render(el, state, ui) {
    const seqs = ui.canAct ? this.sequences(state) : [];
    const local = ui.local;
    if (local.state !== state) {
      local.state = state;
      local.partial = [];
    }
    const partial = local.partial;
    const matching = seqs.filter((s) => partial.every((p, i) => s.path[i] === p));
    const selectable = new Set(seqs.map((s) => s.path[0]));
    const targets = new Set(partial.length ? matching.map((s) => s.path[partial.length]).filter(Boolean) : []);
    const lastPath = new Set(state.last?.path || []);
    const taken = new Set(state.last?.taken || []);

    const choose = (name) => {
      const next = [...partial, name];
      const still = seqs.filter((s) => next.every((p, i) => s.path[i] === p));
      const done = still.find((s) => s.path.length === next.length);
      if (still.length === 1 || (done && still.length === 1)) return ui.onMove(still[0].id);
      if (done && still.every((s) => s === done)) return ui.onMove(done.id);
      local.partial = next;
      ui.redraw();
    };

    el.innerHTML = '';
    const board = document.createElement('div');
    board.className = 'grid8 checkers';
    for (let r = N - 1; r >= 0; r--) {
      for (let f = 0; f < N; f++) {
        const name = sq(f, r);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'sq';
        cell.dataset.shade = (f + r) % 2 === 0 ? 'dark' : 'light';
        cell.setAttribute('aria-label', name);
        const piece = state.board[r][f];
        if (piece) {
          const disc = document.createElement('span');
          disc.className = 'man';
          disc.dataset.color = piece.who === state.white ? 'light' : 'dark';
          if (piece.king) disc.classList.add('is-king');
          cell.appendChild(disc);
        }
        if (lastPath.has(name)) cell.classList.add('is-last');
        if (taken.has(name)) cell.classList.add('is-taken');
        if (partial.includes(name)) cell.classList.add('is-selected');
        let action = null;
        if (targets.has(name)) {
          cell.classList.add('is-target');
          action = () => choose(name);
        } else if (selectable.has(name)) {
          cell.classList.add('is-movable');
          action = () => {
            local.partial = partial[0] === name ? [] : [name];
            ui.redraw();
          };
        }
        if (action) cell.addEventListener('click', action);
        else cell.disabled = true;
        if (f === 0) cell.dataset.rank = r + 1;
        if (r === 0) cell.dataset.file = 'abcdefgh'[f];
        board.appendChild(cell);
      }
    }
    el.appendChild(board);
  },
};
