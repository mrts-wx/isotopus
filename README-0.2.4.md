# Isótopus 0.2.4 — Downloads mais estáveis e navegação organizada

Esta atualização melhora a confiabilidade de downloads de playlists e reorganiza a interface de downloads e da página inicial.

## O que mudou

- O yt-dlp busca itens de playlists gradualmente, limita downloads simultâneos de fragmentos e inclui pausas e retentativas para lidar melhor com limites temporários dos sites. Playlists continuam limitadas a 100 faixas.
- O progresso de cada faixa fica no **Gerenciador de downloads**, acessível no canto superior direito. A página de downloads exibe uma caixa compacta com o estado geral. É possível limpar tarefas concluídas.
- Configurações e gerenciador ficam lado a lado no topo. O cartão de pasta monitorada saiu da lateral para liberar espaço para a navegação.
- A página inicial destaca os álbuns e artistas mais presentes na biblioteca.
- O acrílico do miniplayer fica mais visível nos temas claro e escuro.

## Instaladores

- Ubuntu/Debian: `Isotopus-0.2.4-amd64.deb`
- Arch Linux: `Isotopus-0.2.4-x64.pacman`
- Windows x64: `Isotopus-0.2.4-setup-x64.exe`

Baixe o instalador correspondente ao sistema. No Ubuntu, instale com `sudo apt install ./Isotopus-0.2.4-amd64.deb`; no Arch, use `sudo pacman -U ./Isotopus-0.2.4-x64.pacman`. No Windows, execute o instalador.

A pausa entre itens pode deixar playlists mais lentas, mas reduz falhas associadas a solicitações em sequência. A compatibilidade depende dos extratores e das políticas de cada serviço.
