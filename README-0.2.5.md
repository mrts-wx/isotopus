# Isótopus 0.2.5 — Aparência adaptável e ações rápidas

A 0.2.5 é uma atualização grande de interface e fluxo de biblioteca. Ela adiciona opções visuais configuráveis e ações por faixa para tarefas comuns.

## Tema e aparência

Em **Configurações → Tema e aparência**, abra **Personalizar** para escolher:

- **Paleta:** Automático, Claro ou Escuro.
- O tema claro, escuro e automático usa fundos consistentes na tela, na lateral, no topo e no miniplayer.

As configurações estão separadas por Biblioteca, Aparência, Janela e Reprodução. Mica, Vidro e fundos dinâmicos foram pausados nesta build enquanto os efeitos visuais são revisados. O equalizador pode ser aberto pelo player, onde também é possível ativar ou desativar o efeito. A dock lateral desliza até a nova aba selecionada. No player de letras, os controles também oferecem volume recolhível e acesso direto ao equalizador, cuja ativação fica junto dos ajustes de bandas. A linha ativa da letra tem brilho pulsante mais visível nos dois temas.

## Menu de faixa

Use o botão de três linhas em uma faixa para adicioná-la a uma playlist, favoritar, colocá-la como próxima na fila ou excluir o arquivo. Dentro de uma playlist também é possível remover a faixa da seleção. O menu se abre para o lado com mais espaço.

A exclusão do arquivo pede confirmação. Ela só funciona para arquivos dentro de pastas monitoradas e também remove a faixa de favoritos, recentes, fila e playlists.

## Correções de estabilidade

- A inicialização dos botões, do volume e da leitura da biblioteca foi corrigida.
- Pastas de cache são criadas antes de gravar capas, e capas ausentes são reconstruídas ao abrir o app.
- A varredura inicial é compartilhada entre a janela e o processo principal para evitar trabalho duplicado.
- A letra em foco ganhou espaço para o brilho não ser cortado nas bordas e transição suave entre versos.
- O controle de volume na tela de letras usa o mesmo ícone de alto-falante do miniplayer.

## Instaladores

- Ubuntu/Debian: `Isotopus-0.2.5-amd64.deb`
- Arch Linux: `Isotopus-0.2.5-x64.pacman`
- Windows x64: `Isotopus-0.2.5-setup-x64.exe`

No Ubuntu, instale com `sudo apt install ./Isotopus-0.2.5-amd64.deb`; no Arch, use `sudo pacman -U ./Isotopus-0.2.5-x64.pacman`. No Windows, execute o instalador.
