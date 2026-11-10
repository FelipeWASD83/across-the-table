// Tic-tac-toe. Cells A1..C3 (letter = column, number = row, row 1 on top). The person is X, Claude is O.

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const cellName = (i) => 'ABC'[i % 3] + (Math.floor(i / 3) + 1);
const cellIndex = (name) => 'ABC'.indexOf(name[0]) + (Number(name[1]) - 1) * 3;

function winnerLine(cells) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return line;
  }
  return null;
}

export default {
  id: 'tictactoe',
  name: 'Jogo da velha',
  blurb: 'Três em linha num tabuleiro 3 por 3.',
  pieces: { human: 'X', claude: 'O' },

  create(humanFirst) {
    return { cells: Array(9).fill(null), turn: humanFirst ? 'human' : 'claude', last: null };
  },

  moves(state) {
    if (this.outcome(state)) return [];
    return state.cells.map((c, i) => (c ? null : cellName(i))).filter(Boolean);
  },

  play(state, id) {
    const cells = state.cells.slice();
    cells[cellIndex(id)] = state.turn;
    return { cells, turn: state.turn === 'human' ? 'claude' : 'human', last: id };
  },

  notation(state, id) {
    return id;
  },

  outcome(state) {
    const line = winnerLine(state.cells);
    if (line) return { winner: state.cells[line[0]], reason: 'três em linha', line };
    if (state.cells.every(Boolean)) return { winner: 'draw', reason: 'tabuleiro cheio' };
    return null;
  },

  describe(state) {
    const mark = (c) => (c === 'claude' ? 'O' : c === 'human' ? 'X' : '.');
    const rows = [0, 1, 2].map((r) => `${r + 1}  ${[0, 1, 2].map((c) => mark(state.cells[r * 3 + c])).join(' ')}`);
    return `You are O, the person is X.\n\n   A B C\n${rows.join('\n')}`;
  },

  render(el, state, ui) {
    const result = this.outcome(state);
    const legal = new Set(ui.canAct ? this.moves(state) : []);
    el.innerHTML = '';
    const board = document.createElement('div');
    board.className = 'ttt';
    state.cells.forEach((cell, i) => {
      const name = cellName(i);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ttt-cell';
      btn.setAttribute('aria-label', `Casa ${name}${cell ? (cell === 'human' ? ', X' : ', O') : ''}`);
      if (cell) btn.innerHTML = cell === 'human' ? MARK_X : MARK_O;
      if (cell) btn.dataset.owner = cell;
      if (state.last === name) btn.classList.add('is-last');
      if (result?.line?.includes(i)) btn.classList.add('is-win');
      if (legal.has(name)) btn.addEventListener('click', () => ui.onMove(name));
      else btn.disabled = true;
      board.appendChild(btn);
    });
    el.appendChild(board);
  },
};

const MARK_X = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M24 24 76 76M76 24 24 76" /></svg>';
const MARK_O = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="27" /></svg>';
