# Changelog

## 1.1.0 (10/11/2026)

**Mudou**

- A dificuldade agora muda só o jeito de jogar, não o modelo: no Fácil o Claude joga como iniciante
  daquele jogo e erra de propósito (sem entregar a partida), no Médio joga como amador e erra de vez em
  quando, no Difícil joga o melhor que consegue. O Claude estava bom demais no xadrez e na velha.
- Os três níveis usam o Claude Haiku 5.5, com esforço baixo no Fácil e no Médio e médio no Difícil.
- Configurações tem um modelo só e dois esforços (Fácil e Médio, e Difícil).
- A súmula mostra em que nível foi cada lance do Claude.

## 1.0.0 (10/11/2026)

**Novo**

- Seis jogos contra o Claude: xadrez, damas (regra brasileira), jogo da velha, quatro em linha,
  reversi e Bate-Cor (cartas).
- Seletor de dificuldade: Fácil (Haiku 5.5), Médio (Sonnet 5.5) e Difícil (Opus 5.5), com modelo e
  esforço trocáveis em Configurações.
- Escolha de quem começa a próxima partida.
- Súmula com todos os lances e o modelo que jogou cada um, e o custo da partida em cima da mesa.
- O Claude só escolhe entre lances legais; se não escolher, o app joga um aleatório e avisa.
- Reserva no GPT quando o crédito do Claude acaba (precisa da chave da OpenAI).
- Chaves guardadas só neste PC, protegidas pelo Windows.
- Atualização pelo próprio app, pelas versões publicadas no GitHub.
- Atalho no Menu Iniciar com janela própria.
