# Isótopus

Player de música local para Ubuntu. A biblioteca é indexada a partir de uma ou mais pastas escolhidas no app. A interface exibe tags, capas, duração, codec, taxa de amostragem e profundidade de bits quando disponíveis. Os arquivos de áudio permanecem locais. Quando solicitadas, buscas de letras enviam metadados da faixa ao LRCLIB; a busca manual abre o navegador com o título e artista para pesquisa.

## Formatos

O player lê FLAC, WAV, AIFF, M4A/ALAC, MP3, AAC, Ogg e Opus. A reprodução passa pelo decodificador de áudio do Chromium/Electron e pelo dispositivo de saída selecionado no Ubuntu. Não prometemos saída bit-perfect: o sistema de áudio pode aplicar mixagem ou reamostragem.

O Isótopus classifica o codec armazenado. Ele não consegue confirmar se um FLAC foi criado a partir de uma origem sem perdas ou convertido de um arquivo comprimido. `yt-dlp` seleciona o melhor fluxo oferecido pela origem, que pode continuar comprimido; converter esse fluxo para FLAC não recupera os dados descartados.

## Playlists e letras

Crie playlists locais no painel lateral e adicione faixas pelo botão `＋` dos cards. A fila pode ser exportada como M3U8. Clique na capa do player para abrir a tela de reprodução com letras: o Isótopus lê um `.lrc` ao lado da música, abre arquivos `.lrc`/`.txt`, busca faixas sob demanda no [LRCLIB](https://lrclib.net/docs) e permite ajustar o offset ou marcar cada linha no tempo atual. Se a busca não encontrar a letra, pesquise no navegador, copie o texto e cole no campo do app. Tempos no formato LRC são detectados automaticamente; texto simples pode ser sincronizado linha por linha. Letras podem ser salvas como `.lrc` junto da faixa.

## Executar

```bash
npm install
npm start
```

Na primeira execução, escolha uma pasta com seus arquivos. O app acompanha mudanças e atualiza a biblioteca. Use **Biblioteca e ajustes → Adicionar pasta** para incluir mais pastas.
Depois que uma pasta for selecionada, o painel de boas-vindas some; o cartão da biblioteca e **Biblioteca e ajustes** abrem o gerenciamento de pastas.

Para criar o instalador Ubuntu `.deb`:

```bash
npm run build:ubuntu
```

## Controles

O Isótopus salva volume, aleatório e repetição. Os controles de mídia do desktop são integrados quando disponíveis. Atalhos: `Espaço` reproduz/pausa, `←/→` busca 5 segundos, `Shift + ←/→` troca de faixa, `↑/↓` ajusta o volume e `Ctrl + K` foca a busca. Coleções grandes carregam em blocos para manter a interface leve. A busca ignora acentos, então “João” também encontra “Joao”.

## Verificação

```bash
npm test
npm audit --audit-level=low
```
