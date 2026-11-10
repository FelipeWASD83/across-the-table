// Reversi on 8x8. Squares a1..h8, row 1 on top (the usual Othello notation). Whoever starts plays dark.
// A player with no legal placement must pass ("pass"); when neither can move the game ends.

const N = 8;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const PASS = 'pass';
const name = (c, r) => 'abcdefgh'[c] + (r + 1);
const coords = (id) => ['abcdefgh'.indexOf(id[0]), Number(id.slice(1)) - 1];
const other = (who) => (who === 'human' ? 'claude' : 'human');

function flipsFor(board, c, r, who) {
  if (board[r][c]) return [];
  const flips = [];
  for (const [dc, dr] of DIRS) {
    const line = [];
    let cc = c + dc;
    let rr = r + dr;
    while (cc >= 0 && cc < N && rr >= 0 && rr < N && board[rr][cc] === other(who)) {
      line.push([cc, rr]);
      cc += dc;
      rr += dr;
    }
    if (line.length && cc >= 0 && cc < N && rr >= 0 && rr < N && board[rr][cc] === who) flips.push(...line);
  }
  return flips;
}

function placements(board, who) {
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (flipsFor(board, c, r, who).length) out.push(name(c, r));
  return out;
}

function count(board) {
  let human = 0;
  let claude = 0;
  for (const row of board) for (const cell of row) {
    if (cell === 'human') human++;
    else if (cell === 'claude') claude++;
  }
  return { human, claude };
}

export default {
  id: 'reversi',
  name: 'Reversi',
  blurb: 'Cerque as peças do Claude para virar a cor delas.',
  pieces: { human: 'Peças', claude: 'Peças' },

  create(humanFirst) {
    const dark = humanFirst ? 'human' : 'claude';
    const light = other(dark);
    const board = Array.from({ length: N }, () => Array(N).fill(null));
    board[3][3] = light; board[4][4] = light;
    board[3][4] = dark; board[4][3] = dark;
    return { board, turn: dark, dark, last: null, flipped: [] };
  },

  moves(state) {
    if (this.outcome(state)) return [];
    const own = placements(state.board, state.turn);
    return own.length ? own : [PASS];
  },

  play(state, id) {
    if (id === PASS) return { ...state, turn: other(state.turn), last: PASS, flipped: [] };
    const [c, r] = coords(id);
    const board = state.board.map((row) => row.slice());
    const flips = flipsFor(board, c, r, state.turn);
    board[r][c] = state.turn;
    for (const [fc, fr] of flips) board[fr][fc] = state.turn;
    return { ...state, board, turn: other(state.turn), last: id, flipped: flips.map(([fc, fr]) => name(fc, fr)) };
  },

  notation(state, id) {
    return id === PASS ? 'passou' : id;
  },

  score(state) {
    return count(state.board);
  },

  outcome(state) {
    if (placements(state.board, 'human').length || placements(state.board, 'claude').length) return null;
    const { human, claude } = count(state.board);
    const reason = `${human} a ${claude}`;
    if (human === claude) return { winner: 'draw', reason };
    return { winner: human > claude ? 'human' : 'claude', reason };
  },

  describe(state) {
    const mine = state.dark === 'claude' ? 'X (dark)' : 'O (light)';
    const theirs = state.dark === 'claude' ? 'O (light)' : 'X (dark)';
    const mark = (cell) => (cell === null ? '.' : (cell === state.dark ? 'X' : 'O'));
    const rows = state.board.map((row, r) => `${r + 1} ${row.map(mark).join(' ')}`);
    const { human, claude } = count(state.board);
    const pass = placements(state.board, 'claude').length ? '' : '\nYou have no legal placement, so you must pass.';
    return `You are ${mine}, the person is ${theirs}. Row 1 is the top line.\n\n  a b c d e f g h\n${rows.join('\n')}\n\nDiscs: you ${claude}, the person ${human}.${pass}`;
  },

  render(el, state, ui) {
    const legal = new Set(ui.canAct ? this.moves(state) : []);
    const flipped = new Set(state.flipped);
    el.innerHTML = '';
    const board = document.createElement('div');
    board.className = 'grid8 reversi';
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const id = name(c, r);
        const sq = document.createElement('button');
        sq.type = 'button';
        sq.className = 'sq';
        sq.setAttribute('aria-label', id);
        const cell = state.board[r][c];
        if (cell) {
          const disc = document.createElement('span');
          disc.className = 'disc';
          disc.dataset.color = cell === state.dark ? 'dark' : 'light';
          if (flipped.has(id)) disc.classList.add('is-flipped');
          sq.appendChild(disc);
        }
        if (state.last === id) sq.classList.add('is-last');
        if (legal.has(id)) {
          sq.classList.add('is-target');
          sq.addEventListener('click', () => ui.onMove(id));
        } else sq.disabled = true;
        if (c === 0) sq.dataset.rank = r + 1;
        if (r === N - 1) sq.dataset.file = 'abcdefgh'[c];
        board.appendChild(sq);
      }
    }
    el.appendChild(board);
    if (legal.has(PASS)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary board-action';
      btn.textContent = 'Passar a vez (sem lance possível)';
      btn.addEventListener('click', () => ui.onMove(PASS));
      el.appendChild(btn);
    }
  },
};
