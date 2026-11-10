// Four in a row: 7 columns, 6 rows. A move is the column number (1-7). Row 0 is the bottom.

const COLS = 7;
const ROWS = 6;

function findLine(grid, owner) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (grid[c][r] !== owner) continue;
      for (const [dc, dr] of dirs) {
        const line = [[c, r]];
        for (let k = 1; k < 4; k++) {
          const cc = c + dc * k;
          const rr = r + dr * k;
          if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS || grid[cc][rr] !== owner) break;
          line.push([cc, rr]);
        }
        if (line.length === 4) return line;
      }
    }
  }
  return null;
}

export default {
  id: 'connect4',
  name: 'Quatro em linha',
  blurb: 'Solte as fichas e alinhe quatro antes do Claude.',
  pieces: { human: 'Ficha clara', claude: 'Ficha escura' },

  create(humanFirst) {
    return { grid: Array.from({ length: COLS }, () => []), turn: humanFirst ? 'human' : 'claude', last: null };
  },

  moves(state) {
    if (this.outcome(state)) return [];
    const out = [];
    for (let c = 0; c < COLS; c++) if (state.grid[c].length < ROWS) out.push(String(c + 1));
    return out;
  },

  play(state, id) {
    const col = Number(id) - 1;
    const grid = state.grid.map((column) => column.slice());
    grid[col].push(state.turn);
    return { grid, turn: state.turn === 'human' ? 'claude' : 'human', last: [col, grid[col].length - 1] };
  },

  notation(state, id) {
    return `coluna ${id}`;
  },

  outcome(state) {
    for (const owner of ['human', 'claude']) {
      const line = findLine(state.grid, owner);
      if (line) return { winner: owner, reason: 'quatro em linha', line };
    }
    if (state.grid.every((col) => col.length === ROWS)) return { winner: 'draw', reason: 'tabuleiro cheio' };
    return null;
  },

  describe(state) {
    const lines = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      lines.push(state.grid.map((col) => (col[r] === 'claude' ? 'C' : col[r] === 'human' ? 'P' : '.')).join(' '));
    }
    return `You are C, the person is P. Columns 1 to 7 from left to right; the bottom row is the last line.\n\n${lines.join('\n')}\n1 2 3 4 5 6 7`;
  },

  render(el, state, ui) {
    const result = this.outcome(state);
    const legal = new Set(ui.canAct ? this.moves(state) : []);
    const winSet = new Set((result?.line || []).map(([c, r]) => `${c}:${r}`));
    el.innerHTML = '';
    const board = document.createElement('div');
    board.className = 'c4';
    for (let c = 0; c < COLS; c++) {
      const id = String(c + 1);
      const col = document.createElement('button');
      col.type = 'button';
      col.className = 'c4-col';
      col.setAttribute('aria-label', `Coluna ${id}`);
      for (let r = ROWS - 1; r >= 0; r--) {
        const slot = document.createElement('span');
        slot.className = 'c4-slot';
        const owner = state.grid[c][r];
        if (owner) slot.dataset.owner = owner;
        if (state.last && state.last[0] === c && state.last[1] === r) slot.classList.add('is-last');
        if (winSet.has(`${c}:${r}`)) slot.classList.add('is-win');
        col.appendChild(slot);
      }
      if (legal.has(id)) col.addEventListener('click', () => ui.onMove(id));
      else col.disabled = true;
      board.appendChild(col);
    }
    el.appendChild(board);
  },
};
