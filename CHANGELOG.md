# Isótopus 0.2.1

## Uso de memória

- Capas incorporadas nos arquivos de música são lidas do cache em disco sob demanda, em vez de manter todas as imagens carregadas na memória do processo principal.
- Miniaturas de capas são solicitadas com carregamento preguiçoso e baixa prioridade; listas exibem 48 faixas por lote, com o botão existente para carregar mais.
- A biblioteca, reprodução, capas e sincronização de letras mantêm o mesmo comportamento.
- Corrigido o padding padrão do botão do miniplayer, que deixava uma faixa do fundo visível ao redor da capa; a capa do player carrega imediatamente.
- Reordenadas as camadas da linha do player para manter o marcador vertical acima da barra.
- Linhas com tempo em letras LRC agora permitem clicar para buscar a reprodução naquele ponto, respeitando o ajuste de sincronização atual.
- A sincronização manual pode ser refeita depois de concluída; a marcação anterior só é substituída no primeiro clique de uma nova tentativa.

---

# Isótopus 0.2.0

## Letras

- Ao abrir as letras de uma faixa, o Isótopus busca automaticamente no LRCLIB usando título, artista, álbum e duração, priorizando a gravação com correspondência mais forte.
- Letras sincronizadas aparecem prontas. Se não houver correspondência, o app informa isso e mantém as opções de buscar na web, colar uma letra ou abrir um arquivo local.
- Letras sem tempos podem receber sincronização estimada com Whisper small no próprio computador. O áudio não é enviado; o modelo é baixado na primeira utilização e fica em cache local.
- O resultado fica salvo no Isótopus e pode ser exportado em LRC. Revise a sincronização: reconhecimento de vocais, remixes e gravações diferentes podem gerar tempos incorretos. Limite: 10 minutos e 160 MB.

## Aparência e uso

- Corrigido o empilhamento dos menus de tema e escala nas configurações.
- A barra de progresso voltou à linha grossa e sólida nos estados de reprodução e pausa, tanto no player compacto quanto na tela de letras.
- Os nomes e artistas dos cards ficam brancos e mais legíveis no tema escuro.
- Antes de sincronizar, um aviso explica que os tempos são estimados e podem errar; a pessoa escolhe recusar ou prosseguir.
- Evitado o carregamento da biblioteca nativa Sharp/libvips no runtime Electron durante a transcrição, prevenindo encerramentos inesperados no Linux; análise de letras usa apenas áudio.
- A transcrição roda em um processo auxiliar separado, com limites de memória e geração por trecho; o Isótopus permanece aberto e pode ser usado enquanto ela trabalha.
- A sincronização usa Whisper small quantizado, e o progresso do download é limitado para manter a janela responsiva. Erros ao carregar o modelo ou reconhecer a música mostram causas distintas.
- Aberturas repetidas do Isótopus focam a janela existente, mesmo quando está oculta na bandeja; a linha de cada letra só acende quando chega ao seu tempo LRC.
- Capa que não carrega mostra o disco ilustrado do Isótopus; o destaque da letra no tema claro usa um tom mais suave.

- Tema escuro redesenhado com superfícies grafite azuladas, contraste reforçado e correções para cartões, diálogos, menus, bordas e tela de letras.
- Nova escala de interface em Configurações: 100%, 125%, 150% ou 175%, salva neste computador e aplicada ao app inteiro.
- O controle de busca da música usa um marcador vertical arredondado e mais largo; durante a reprodução, a trilha anima suavemente e para ao pausar. Respeita a preferência por movimento reduzido.
- O ícone do app e os ícones dos instaladores Linux e Windows agora são gerados diretamente da imagem de marca fornecida.
- Mantidos controles existentes de pesquisa web, sincronização manual, equalizador, crossfade, fila, favoritos e atalhos de teclado.

## Observações

- A busca LRCLIB depende de metadados e disponibilidade do catálogo; ela não verifica o canal de origem do áudio. Remixes e versões alternativas podem não ter correspondência correta.
- A primeira sincronização automática precisa de internet para baixar o modelo. A análise do áudio é local e experimental.
- Pacotes Windows x64, Debian/Ubuntu amd64 e Arch Linux x86_64 estão anexados à Release `v0.2.0`.

---

# Isótopus 0.1.9

## Mais controle do som, uma biblioteca mais útil

### Equalizador

- Corrigido o ajuste do perfil personalizado, que podia saltar para **−12 dB** ao clicar na barra.
- O editor agora abre em uma janela própria, em **Configurações → Equalizador → Editar equalizador**.
- Os controles ganharam escala e área de interação corrigidas, valores em passos de 0,5 dB e um menu de perfis integrado ao tema do app.

### Página inicial

- Adicionados atalhos para reproduzir a biblioteca inteira ou começar uma reprodução aleatória.
- As faixas favoritas agora aparecem em uma seção própria, com acesso rápido à lista completa.
- O botão **Ver histórico**, que não levava a uma tela útil, foi removido.
- A seção de reprodução rápida mostra a quantidade de faixas disponíveis e tem estados vazios mais claros.

### Interface e capas

- Os três cards de resumo deixam de piscar ao passar o cursor ou pressioná-los; o destaque visual permanece estável.
- Novo ícone de capa na identidade visual do Isótopus para álbuns e faixas sem imagem, presente nos cards, no player e na tela de letras.
- Grupos de álbum e artista aproveitam a primeira capa disponível em qualquer faixa do grupo.
- Configurações reorganizadas em abas, com menus personalizados nos temas claro e escuro.

### Pacotes para teste

- Windows x64: instalador `.exe`.
- Debian/Ubuntu amd64: pacote `.deb`.
- Arch Linux x86_64: pacote `.pacman`.

Esta build foi criada para testes. Os pacotes Windows não têm assinatura de código e podem mostrar um aviso do SmartScreen.
