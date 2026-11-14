# Isótopus 0.2.2 — Major Update

A versão 0.2.2 traz a primeira grande atualização visual do Isótopus e adiciona uma ferramenta opcional para baixar áudio compatível diretamente para sua biblioteca local.

## Baixe e organize suas músicas

Na nova aba **Baixar música**, cole um link público de um site compatível com o yt-dlp. O Isótopus baixa o melhor áudio disponível, converte para MP3 e incorpora a miniatura como capa, além dos metadados fornecidos pelo site, como título e artista.

A barra acompanha o percentual de transferência em tempo real. O download roda em segundo plano, sem abrir uma janela de terminal, e o arquivo é salvo na pasta monitorada que você escolher. Depois que o yt-dlp termina de converter o áudio e adicionar capa e metadados, a biblioteca encontra o novo arquivo.

### Sites e requisitos

- YouTube, SoundCloud, Vimeo, Bandcamp e outros podem funcionar quando o yt-dlp tiver um extrator compatível. A lista muda e os sites podem alterar seu funcionamento.
- Spotify não fornece o áudio para esse fluxo; links do Spotify não baixam músicas.
- A conversão para MP3 e a incorporação da capa usam FFmpeg. Instale-o no sistema: Ubuntu/Debian: `sudo apt install ffmpeg`; Arch: `sudo pacman -S ffmpeg`. No Windows, consulte as opções indicadas em [ffmpeg.org/download.html](https://ffmpeg.org/download.html).
- Na primeira utilização, o Isótopus pede autorização antes de baixar e executar o yt-dlp oficial. O executável fica no perfil do usuário, sem instalação de sistema nem privilégios de administrador.
- Baixe apenas conteúdo que você tem direito de salvar.

## Atualização simplificada

Ao iniciar, o Isótopus verifica se há uma versão mais recente e apresenta o instalador adequado ao sistema detectado: `.deb` para Ubuntu/Debian, `.pacman` para Arch ou `.exe` para Windows. A instalação é confirmada pela pessoa usuária.

## Renovação visual

A navegação, os cartões, a hierarquia tipográfica e os espaços foram renovados, mantendo os cantos arredondados e a identidade do Isótopus. A navegação lateral não mostra barras de rolagem; em janelas baixas, ela ainda pode ser percorrida por gesto.

## Instaladores 0.2.2

- **Ubuntu/Debian:** `Isotopus-0.2.2-amd64.deb`
- **Arch Linux:** `Isotopus-0.2.2-x64.pacman`
- **Windows x64:** `Isotopus-0.2.2-setup-x64.exe`

Consulte o [README principal](README.md) para obter instruções de instalação e outros detalhes do app.
