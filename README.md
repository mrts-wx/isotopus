# Isótopus

Player de música local para Ubuntu. A biblioteca é indexada a partir de uma ou mais pastas escolhidas no app. A interface exibe tags, capa, duração, codec, taxa de amostragem e profundidade de bits quando disponíveis; arquivos não são enviados para nenhum servidor.

## Formatos

O player lê FLAC, WAV, AIFF, M4A/ALAC, MP3, AAC, Ogg e Opus. A reprodução passa pelo decodificador de áudio do Chromium/Electron e pelo dispositivo de saída selecionado no Ubuntu. Não prometemos saída bit-perfect: o sistema de áudio pode aplicar mixagem ou reamostragem.

O Isótopus classifica o codec armazenado. Ele não consegue confirmar se um FLAC foi criado a partir de uma origem sem perdas ou convertido de um arquivo comprimido. `yt-dlp` seleciona o melhor fluxo oferecido pela origem, que pode continuar comprimido; converter esse fluxo para FLAC não recupera os dados descartados.

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

## Rich Presence

Opcionalmente, informe o Application ID de uma aplicação Discord nas configurações. O cliente Discord desktop precisa estar aberto.

## Controles

O Isótopus salva volume, aleatório e repetição. Os controles de mídia do desktop são integrados quando disponíveis. Atalhos: `Espaço` reproduz/pausa, `←/→` busca 5 segundos, `Shift + ←/→` troca de faixa, `↑/↓` ajusta o volume e `Ctrl + K` foca a busca. Coleções grandes carregam em blocos para manter a interface leve.

## Verificação

```bash
npm test
npm audit --audit-level=low
```
