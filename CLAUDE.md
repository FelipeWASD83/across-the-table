# CLAUDE.md: across-the-table ("Do Outro Lado")

App local com seis jogos contra o Claude e seletor de dificuldade. Criado em 10/11/2026 a pedido dele
("crie um site com vários jogos como xadrez, dama, jogo da velha, uno, etc onde o jogador joga contra a
api do claude, também coloque um seletor de dificuldade"). O `CLAUDE.md` da raiz vale aqui também; o uso,
para ele, está no `README.md`.

Versão atual: `versao.json` (mesmo número no topo do `CHANGELOG.md`).

## 1. Como roda

```
Menu Iniciar "Do Outro Lado" ─► _organizacao\atalhos\janela-app (Electron, --app=across-the-table)
                                 └─► python start.py   (aplica atualização baixada, sobe e reinicia o servidor)
                                       └─► python server\server.py --porta 8084
janela ◄── http://127.0.0.1:8084/
```

- **Só biblioteca padrão do Python** (Smart App Control), sem venv. HTTP pelo `urllib`.
- Preview: entradas `across-the-table` (8084, dados de verdade) e `across-the-table-demo` (8085) do
  `launch.json` da raiz. A demo (`tools\demo.py`) usa dados em `%TEMP%\across-the-table-demo` e um Claude
  falso que joga um lance aleatório do `enum` depois de 1,2 s (`--pausa` troca). Não gasta crédito.
- Dados em `data/` (fora do git): `config.json` (modelo e esforço de cada nível, reserva) e
  `segredos.json` (chaves da Anthropic, da OpenAI e token do GitHub, protegidas pelo DPAPI).
  `ACROSS_THE_TABLE_DATA` troca a pasta.

## 2. Mapa do código

| Arquivo | O que faz |
|---|---|
| `server/server.py` | Rotas `/api/state`, `/api/config`, `/api/key`, `/api/move`, `/api/update/*` e os estáticos de `app/` |
| `server/ai.py` | O pedido do lance: prompt por jogo e por nível, ferramenta `play_move` com `enum` dos lances legais e `strict`, empurrão único, lance aleatório se falhar, reserva por crédito |
| `server/config.py` | Caminhos, versão, modelos e esforços padrão de cada nível |
| `server/provedor.py` | **Cópia idêntica** do `contato-ia/contato/provedor.py`. Bug nele se corrige no mestre e se copia (com o `tests/test_provedor.py`) |
| `server/segredos.py` | Copiado do `tierlist-ia` (que copiou do `central`): DPAPI |
| `server/atualizador.py`, `start.py` | Atualização pelas releases do GitHub, no modelo do `clave` |
| `app/js/app.js` | Partida por jogo, turnos, pedido do lance, súmula, Configurações |
| `app/js/games/*.js` | Um módulo por jogo com a mesma interface: `create`, `moves`, `play`, `outcome`, `describe` (texto em inglês para o Claude), `notation` (súmula), `render` |
| `app/js/games/chess-pieces.js` | As peças de xadrez, desenhadas para o projeto (SVG) |
| `app/vendor/chess.js` | chess.js 1.4.0 (BSD-2, licença ao lado), regras do xadrez |
| `tests/` | unittest com API falsa (`fakes.py`) e `tests/js/rules.test.mjs` (regras dos seis jogos, `node --test`) |

## 3. Decisões (não desfazer sem motivo novo)

- **Web, e não nativo**: a regra da raiz diz "jogo nunca em web", mas ele pediu "um site", e são jogos de
  turno (nada desenha em tempo real). Avisado no plano em 10/11/2026; ele aprovou.
- **"Uno" virou Bate-Cor**: mesmo gênero (cor e número, pular, +2, curinga, curinga +4), com nome, cores
  (coral, petróleo, mostarda, oliva) e desenho de carta próprios. Nada do nome nem do visual do UNO. Dois
  jogadores; o +4 vale a qualquer hora; sem empilhar +2.
- **As regras moram na tela; o Claude só escolhe.** A tela manda a posição em texto e a lista de lances; o
  `enum` do `play_move` com `strict: true` impede lance fora da lista. Se mesmo assim vier errado (ou em texto)
  duas vezes, joga um lance legal aleatório e a súmula avisa. Lance único é jogado sem chamar a API.
- **Cada lance é um pedido novo** (sem histórico de conversa): a posição já leva o que importa (FEN e lances
  no xadrez, o placar no reversi, as últimas jogadas no Bate-Cor). Evita a regra de pensamento preservado e
  mantém o custo previsível.
- **Níveis**: Fácil = Haiku 5.5 esforço baixo e instrução de jogar casual; Médio = Sonnet 5.5 médio; Difícil =
  Opus 5.5 alto. Modelo e esforço trocáveis em Configurações; o estilo de jogo (texto `STYLES` do `ai.py`) não.
- **Reserva de recusa no servidor** (`fallbacks: "default"` com o beta `server-side-fallback-2026-07-01`) nos
  modelos que aceitam (Opus 5.5, Sonnet 5.5, Fable). No Haiku não existe. Nunca testado com a API de verdade:
  se a primeira chamada real der 400 citando `fallbacks`, o suspeito é esse campo.
- **Damas**: o jogador fica sempre embaixo e quem começa joga de brancas; peça capturada fica no tabuleiro até
  o fim do lance (não se pula duas vezes); empate depois de 20 lances seguidos de cada lado só com dama e sem
  captura.
- **Visual "Súmula"** (direção fechada em 10/11/2026, referência Linear `prints/produto-linear-hero.png`: frase
  de duas cores no status do Claude e súmula com números tabulares). Mesa clara, o tabuleiro é o herói e a cor
  vem das peças. Claude senta na faixa de cima, você na de baixo. Fontes Bricolage Grotesque (títulos) e
  Atkinson Hyperlegible (texto), servidas da pasta `app/fonts`. Outras direções descartadas: "Ludoteca" (cor de
  brinquedo, sombra dura) e "Salão escuro".
- **Segurança local** (como o `tierlist-ia`): só 127.0.0.1, `Host` conferido, toda `/api` exige `X-Mesa: 1`,
  `Origin` de fora é recusado, a chave nunca volta para a tela (só os 4 últimos caracteres).

## 4. Testes e verificação

```
python -m unittest discover -s tests -t .     # nesta pasta; 71 testes, uns 7 s, sem rede
node --test tests/js/rules.test.mjs           # regras dos seis jogos, 16 testes, ~1 s
```

- 10/11/2026, na demo: os seis jogos jogados pela interface (lance, Claude pensando com o tempo, resposta,
  súmula, custo), Claude começando no Difícil, fim de partida com "Jogar de novo", Configurações (salvar
  modelo do nível, chave, procurar atualização). Layout conferido em tela ultrawide e em tela em pé.
- **Nunca chamado com a chave real**: Claude e GPT de verdade não foram testados. Suspeitos se der erro na
  primeira partida real: o campo `fallbacks` e o `strict` com `enum`.
- O atualizador nunca rodou contra uma release de verdade.

## 5. Fim de tarefa

Subir a versão (`versao.json` e `CHANGELOG.md`), commit, backup. Release e push são decisão dele.
