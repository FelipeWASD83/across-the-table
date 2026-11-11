# Do Outro Lado

Seis jogos para jogar contra o Claude, com seletor de dificuldade:

- **Xadrez**, com todas as regras (roque, en passant, promoção, empates).
- **Damas** na regra brasileira: captura obrigatória, lei da maioria, dama que voa.
- **Jogo da velha**.
- **Quatro em linha**.
- **Reversi**.
- **Bate-Cor**, jogo de cartas de cor e número (pular, +2, curinga, curinga +4). Quem esvazia a mão primeiro ganha.

## Como abrir

Pelo atalho **Do Outro Lado** no Menu Iniciar. Ele abre numa janela própria.
Também dá para dar dois cliques em `open-in-browser.bat`, que abre no navegador.

Na primeira vez, clique em **Configurações** (canto de baixo da lateral) e cole a chave da
Anthropic. Ela fica guardada só neste PC, protegida pelo Windows. A chave da OpenAI é opcional:
serve de reserva quando o crédito do Claude acaba.

## Como jogar

- Escolha o jogo na lateral. Cada jogo guarda a própria partida, então dá para trocar de jogo no
  meio e voltar.
- **Dificuldade**: Fácil, Médio ou Difícil. Vale a partir do próximo lance do Claude, mesmo no meio
  da partida.
- **Na próxima partida começa**: você ou o Claude. Vale quando você aperta **Nova partida**.
- No xadrez, clique na peça e depois na casa. Na promoção aparece a escolha da peça.
- Nas damas, clique na peça e depois em cada casa do caminho (numa captura em sequência, uma casa
  por vez). Só aparecem as peças que podem jogar.
- No Bate-Cor, as cartas que você pode jogar ficam levantadas. Curinga pede a cor. Sem jogada,
  clique no monte para comprar.
- A **Súmula**, à direita, lista os lances e qual modelo jogou cada um. Em cima da mesa aparece
  quanto a partida já custou.

## O que cada nível muda

Fácil, Médio e Difícil usam o mesmo modelo (Claude Haiku 5.5, por padrão). O que muda é como o
Claude é instruído a jogar. O Impossível é a exceção: usa o Claude Fable 5.2 no esforço máximo.

| Nível | Como joga | Esforço |
|---|---|---|
| Fácil | como iniciante naquele jogo, errando de propósito, mas sem entregar a partida | baixo |
| Médio | como amador: sabe o básico e erra uma jogada em cada três, mais ou menos | baixo |
| Difícil | o melhor que consegue | médio |
| Impossível | o melhor que consegue, com o Claude Fable 5.2 pensando no máximo | máximo |

Cada jogo tem o próprio jeito de iniciante (no xadrez, mexer peça sem plano e deixar peça
desprotegida; na velha, esquecer de bloquear; no reversi, ignorar os cantos). Mesmo errando de
propósito, ele aproveita vitória que está na cara.

Modelo e esforços se trocam em Configurações (o Impossível tem os campos próprios).

Custo (estimativa, não medida): no Haiku cada lance custa uma fração de centavo. No Impossível é
outra conversa: o Fable 5.2 custa 80 vezes o Haiku por token e, no esforço máximo, pensa muito, então
um lance pode custar perto de US$ 1 e levar alguns minutos. Uma partida de xadrez inteira nele pode
passar de US$ 30. Vale olhar o custo da partida em cima da mesa. Quando só existe
um lance possível, o app joga sozinho sem chamar a API.

## Se precisar mexer à mão

- Porta: no arquivo `server/config.py`, procure `PORT = 8084` e troque o número (e a entrada
  `across-the-table` em `_organizacao\atalhos\janela-app\apps.json`).
- Cor de alguma coisa: no arquivo `app/css/app.css`, o bloco `:root` no começo tem todas as cores
  com um comentário dizendo o que cada grupo pinta.

## Demonstração sem gastar crédito

`python tools\demo.py` sobe o app na porta 8085 com um Claude falso que joga um lance legal
aleatório. Os dados ficam numa pasta temporária.

## Licença

MIT (arquivo `LICENSE`). O chess.js, em `app/vendor`, é BSD-2 (`app/vendor/chess.js.LICENSE`). As fontes
Bricolage Grotesque e Atkinson Hyperlegible, em `app/fonts`, são da SIL Open Font License (licenças ao lado).
