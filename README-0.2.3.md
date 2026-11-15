# Isótopus 0.2.3 — Downloads em lote e mais controle da coleção

A versão 0.2.3 expande o downloader do Isótopus para playlists, adiciona controles de edição das playlists locais e refina o player no tema claro.

## Baixar faixa ou playlist

Cole um link no mesmo campo e use **Baixar MP3**. Links de faixa e playlists compatíveis com yt-dlp usam o mesmo fluxo. Cada faixa da lista ganha seu próprio progresso, nome e posição. Se uma faixa falhar, o app tenta continuar com as demais e informa os erros ao final.

Por estabilidade, o app processa até os primeiros 100 itens de cada playlist. Faixas que já existem não são sobrescritas. Os downloads continuam convertidos para MP3 com capa e metadados, e são salvos na pasta monitorada selecionada.

O app exige FFmpeg instalado e pede consentimento antes do primeiro uso do yt-dlp. O downloader valida links HTTP/HTTPS, recusa endereços locais, confirma que a pasta escolhida continua disponível e inicia o processo sem shell, em segundo plano. Baixe apenas conteúdo que você tem direito de salvar. Spotify não fornece áudio para este fluxo.

## Organize playlists

Na coleção de playlists, use os botões do cartão para renomear ou excluir. A exclusão pede confirmação e remove somente a playlist, sem apagar os arquivos de música. Dentro dela, você pode adicionar, remover e reordenar faixas.

## Refinamentos visuais

No tema claro, o miniplayer tem um fundo acrílico leve: deixa as cores sob ele aparecerem suavemente com desfoque. A linha ativa das letras pulsa com brilho coral em intensidade variável, sem ficar branca ou apagar. A preferência por movimento reduzido desativa a pulsação.

## Instalação

- Ubuntu/Debian: `Isotopus-0.2.3-amd64.deb`
- Arch Linux: `Isotopus-0.2.3-x64.pacman`
- Windows x64: `Isotopus-0.2.3-setup-x64.exe`

Os instaladores desta versão estão disponíveis nos arquivos anexados à release `v0.2.3`.
