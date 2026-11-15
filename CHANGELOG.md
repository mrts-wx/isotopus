# Isótopus 0.2.6 — Major Update: expansão funcional e refinamento visual

A versão 0.2.6 amplia o controle da reprodução e acrescenta recursos locais de descoberta, organização e acompanhamento da biblioteca. As mudanças preservam a identidade visual atual e reutilizam a mesma sessão de áudio.

## Reprodução e janela compacta

- A fila agora permite arrastar para reordenar, reproduzir uma faixa específica, remover itens individualmente e limpar as próximas faixas sem interromper a música atual.
- Álbuns, artistas e playlists podem ser acrescentados ao fim da fila. A ordem da biblioteca original continua intacta; o modo aleatório trabalha sobre uma cópia da seleção.
- O mini player flutuante oferece capa, faixa, artista, play/pause, anterior/próxima, posição e volume. O layout foi espaçado e alinhado; o controle de volume fica oculto até ser aberto acima do ícone. A seta agora alterna o modo compacto e preserva o controle de manter a janela no topo. O player continua sincronizado com a sessão principal, sem criar uma segunda reprodução.
- Os controles de visualizador, mini player, fila, volume e slider no player inferior compartilham alinhamento e dimensões consistentes.

## Estatísticas e descoberta local

- A nova página de estatísticas registra o tempo de reprodução efetivo e mantém os dados neste computador. Uma reprodução qualificada só é contada após metade de uma faixa curta ou 30 segundos de escuta.
- Os indicadores incluem horas ouvidas, reproduções qualificadas, faixa, artista, álbum e gênero mais reproduzidos, com filtros de período e gráfico mensal.
- A página inicial sugere faixas da própria biblioteca com base em artistas, gêneros, histórico recente e músicas ainda não ouvidas. Com pouco histórico, ela informa que está oferecendo faixas para explorar, sem alegar usar uma IA externa.
- Pastas inteligentes criam coleções dinâmicas por artista, álbum, gênero, ano mínimo e número de reproduções, combinando até duas regras. Elas referenciam as faixas locais e se recalculam quando a biblioteca é atualizada.

## Letras e visualização de áudio

- Cada letra salva exibe sua origem: LRC local, Whisper, marcação manual, LRCLIB, LRC importado ou sem sincronização. O método de origem fica separado do formato `.lrc` exportado.
- O seletor Whisper oferece Tiny, Base e Small; o app consulta o cache instalado, permite remover o modelo selecionado e cancelar uma análise em andamento. Um modelo escolhido é baixado quando necessário ao iniciar a sincronização. A descrição de recursos é relativa, sem prometer benchmarks de memória ou velocidade.
- O seletor de modelo Whisper usa agora o menu visual do Isótopus, em vez do controle nativo do sistema.
- Removido o tooltip nativo ao passar o ponteiro sobre uma linha sincronizada; as linhas continuam clicáveis para buscar o áudio naquele tempo.
- O visualizador oferece Spectrum Analyzer, waveform, barras de frequência, ondas circulares e modo minimalista, alimentados pelo `AnalyserNode` do grafo de áudio existente. O espectro agora ajusta a faixa de frequências ativas à largura disponível, evitando trechos finais permanentemente retos quando as bandas altas estão silenciosas. A animação só roda enquanto a janela do visualizador está aberta e a música está tocando.

## Aparência e transparência

- O popup de aparência mantém as paletas claro/escuro/automática e os estilos Padrão, Mica e Vidro. Mica e Vidro afetam somente docks, busca, botões, menus e janelas sobrepostas; capas e cards da biblioteca preservam o próprio visual. Mica deixa transparecer o conteúdo ao fundo com blur leve; Vidro aumenta transparência e blur sem sacrificar a leitura.
- A ambientação opcional extrai um tom mais evidente da capa e o aplica apenas ao player inferior, miniplayer e realces da tela de letras. O laranja da marca e o restante da interface não mudam de cor. As preferências ficam salvas localmente.
- A dock inferior agora sobrepõe a área rolável, permitindo que capas e conteúdo passem visualmente atrás dela nos estilos Mica e Vidro. O plano de fundo acrílico é contínuo sob a lateral e a biblioteca, mantendo os cards de álbum delimitados e sem aplicar blur às capas.
- Mica e Vidro usam a capa atual como plano de fundo desfocado em toda a janela, mantendo as capas dos cards nítidas e delimitadas. Os estilos têm transparência e desfoque distintos; no tema claro, os textos escurecem para manter o contraste.
- Corrigida a aplicação acidental da superfície escura da lateral no tema claro com estilo Normal; nesse estilo, a lateral volta a usar o painel opaco da paleta escolhida.
- As cores dinâmicas destacam docks, controles e cards de música com um contorno neon pulsante aplicado por dentro das bordas. O brilho fica contido, sem halo vazando para fora; há mais espaço entre a lateral e a dock inferior.
- A tipografia da interface foi padronizada com Inter e alternativas nativas equivalentes; botões mantêm pesos mais firmes e o comando de download recebeu tamanho e hierarquia visual próprios.
- Os menus de período das estatísticas e de estilo do visualizador agora usam o seletor visual do Isótopus, sem abrir listas nativas do sistema.
- A página **Sobre o Isótopus** apresenta versão, manifesto, tecnologias, repositório, créditos de omartinss e assistência de desenvolvimento do Codex (OpenAI), com aviso de que o projeto é independente.
- O código original do projeto passa a usar a licença MIT, incluída no arquivo `LICENSE`; componentes de terceiros mantêm suas próprias licenças.

## Estabilidade e escopo

- Nenhuma dependência de runtime foi adicionada. O visualizador reaproveita o equalizador e o mini player envia comandos à sessão principal, evitando criar um segundo deck de áudio.
- O carregamento de faixas monta 24 cards por lote para reduzir imagens decodificadas e elementos mantidos na tela. Os buffers do visualizador são reutilizados em vez de recriados em cada quadro, e a janela compacta reduz animações em segundo plano.
- As estatísticas e coleções ficam no armazenamento local do aplicativo; nenhuma dessas novas funções envia histórico para servidores externos.
- O editor de metadados diretamente nos arquivos de áudio não entrou nesta versão. A biblioteca atual reconhece múltiplos contêineres, mas não possui um gravador multiplataforma seguro para todos eles; esta versão não altera tags dos arquivos.

---

# Isótopus 0.2.5 — Aparência adaptável e ações rápidas

## Tema e aparência

- Popup de aparência para escolher a paleta automática, clara ou escura; os fundos da tela, do topo, da lateral e do miniplayer usam uma base coerente em cada tema.
- Fundos consistentes entre a tela principal, barra superior, lateral e miniplayer, sem mistura de cores de capa.
- O tema escuro usa tons grafite neutros com detalhes coral, substituindo o verde que tingia grandes áreas da interface.
- O player de letras ganhou um controle de volume recolhível e atalho direto para o equalizador, incluindo ativação e desativação junto do editor de bandas. O brilho pulsante da linha ativa ficou mais evidente nos temas claro e escuro.
- O controle de volume agora usa um ícone de alto-falante mais legível.
- A seleção da dock lateral desliza entre as páginas com uma animação suave e respeita a preferência por movimento reduzido.

## Ações de faixa

- O menu de três linhas em cada faixa oferece adicionar/remover de playlist, favoritar, colocar como próxima na fila e excluir o arquivo. O popup escolhe abrir para cima ou para baixo conforme o espaço disponível.
- A exclusão pede confirmação e o processo principal valida que o arquivo pertence a uma pasta monitorada antes de removê-lo. As referências removidas também saem de favoritas, recentes, fila e playlists.

## Estabilidade e desempenho

- Preferências de aparência são salvas localmente e aplicadas sem reiniciar o app.
- Corrigida a inicialização dos controles: uma referência obsoleta interrompia a ligação dos botões de configurações, downloads, reprodução e volume, além de impedir a leitura da biblioteca ao abrir.
- A pasta de cache é criada antes de salvar capas; capas ausentes em índices antigos são reconstruídas pelas tags dos arquivos.
- A leitura inicial da biblioteca evita varreduras concorrentes, reduzindo disputa pelo cache ao iniciar.
- O texto em foco nas letras tem mais espaço nas laterais, sem cortar o brilho nas bordas; a troca entre versos agora usa uma transição curta e suave e respeita movimento reduzido.
- O botão que abre o controle de volume na tela de letras agora usa o mesmo ícone de alto-falante do miniplayer.

---

# Isótopus 0.2.4 — Downloads mais estáveis e navegação organizada

## Downloads em playlists

- Downloads de playlists agora carregam os itens gradualmente e espaçam as requisições para reduzir falhas por excesso de solicitações.
- yt-dlp tenta novamente erros transitórios de rede, extração e fragmentos, com concorrência de fragmentos limitada.
- O progresso individual continua no gerenciador de downloads do topo; a página de downloads mostra apenas o estado geral da tarefa.
- O menu permite acompanhar vários itens, consultar tarefas recentes e limpar o histórico concluído. A lista não exibe scrollbar.

## Interface

- Os botões do gerenciador de downloads e das configurações ficam juntos no topo. A lateral deixa de exibir o cartão de pasta monitorada, liberando espaço para a navegação.
- A página inicial ganhou destaques de álbuns e artistas da biblioteca.
- O acrílico do miniplayer ficou mais translúcido e com desfoque mais perceptível nos temas claro e escuro.

---

# Isótopus 0.2.3 — Downloads em lote e mais controle da coleção

## Baixar música

- O mesmo campo e botão aceitam link de faixa ou playlist compatível com yt-dlp.
- Playlists mostram uma barra individual por faixa, com título, posição e progresso real; se uma faixa falhar, as demais continuam quando possível.
- Para evitar filas excessivas, playlists processam no máximo os primeiros 100 itens. Faixas já existentes não são sobrescritas.
- O downloader aceita apenas links HTTP/HTTPS, rejeita endereços locais e valida se a pasta monitorada ainda está disponível. yt-dlp continua sendo iniciado sem shell e sem janela de terminal.

## Playlists e acabamento visual

- Playlists podem ser renomeadas e excluídas com confirmação; excluir uma playlist não apaga os arquivos de música.
- Faixas podem ser adicionadas, removidas e reordenadas dentro de uma playlist.
- No tema claro, o miniplayer ganhou fundo acrílico translúcido com desfoque suave.
- A linha ativa da letra ganha um brilho coral pulsante, legível no tema claro e compatível com a preferência por movimento reduzido.

---

# Isótopus 0.2.2

## Atualização e nova interface

- Primeira grande renovação visual: hierarquia tipográfica, superfícies, navegação e espaçamento redesenhados, mantendo os cantos arredondados e a identidade do Isótopus.
- O app consulta as Releases oficiais e avisa quando existe uma versão mais nova, mostrando o instalador de Ubuntu/Debian, Arch ou Windows detectado no sistema. A instalação continua sob controle da pessoa usuária.

## Downloads opcionais

- Nova aba **Baixar música**, com consentimento antes de instalar ou executar o yt-dlp oficial. O executável fica no perfil local do usuário e o processo roda em segundo plano, sem abrir terminal ou sobrepor a janela.
- Baixe o melhor áudio disponível convertido para MP3, incorporando a miniatura como capa e metadados de título/artista no arquivo. A barra acompanha o percentual real de transferência em tempo real e só conclui após conversão e gravação de capa/metadados; o arquivo vai direto para a pasta monitorada selecionada e entra na biblioteca após a varredura.
- YouTube, SoundCloud e outros sites podem funcionar se o extrator do yt-dlp os suportar naquele momento. A lista muda com frequência; Spotify não disponibiliza o áudio neste fluxo.
- Player full: barras de rolagem nativas foram ocultadas na área das letras nos dois eixos, mantendo a rolagem vertical por gesto e roda do mouse; linhas longas quebram dentro do painel.
- Conversão para MP3 requer FFmpeg instalado no sistema. A tela informa quando ele não está disponível.
- A ferramenta aceita links HTTP/HTTPS públicos e não baixa playlists em lote. Use apenas conteúdo que você tem direito de salvar.

---

# Isótopus 0.2.1

## Estrutura interna

- Reorganizado o código em `src/main`, `src/renderer` e `src/shared`, com controladores independentes para biblioteca, playlists, letras e equalizador, facilitando manutenção e novas funções.
- Ícones e recursos da marca agora ficam em pastas próprias; o empacotamento aponta para a nova estrutura.

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
