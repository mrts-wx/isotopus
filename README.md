# Isótopus

Player de música local para Linux e Windows, feito para organizar e ouvir uma coleção pessoal. A biblioteca fica no computador; o app oferece playlists, busca, favoritos, letras sincronizadas, equalizador e controles de mídia do sistema.

## Recursos

- Reprodução local de FLAC, WAV, AIFF, M4A/ALAC, MP3, AAC, Ogg e Opus, conforme o suporte do Electron e do sistema.
- Biblioteca monitorada, playlists, busca, favoritos e fila de reprodução.
- Letras LRC e sincronização manual por faixa.
- Temas claro, escuro e automático, além de equalizador com perfis.
- Pacotes de distribuição para Debian/Ubuntu, Arch e Windows.

O app identifica o codec armazenado, mas não consegue verificar se um arquivo lossless veio de uma fonte sem perdas. A saída de áudio também pode ser mixada ou reamostrada pelo sistema operacional.

## Requisitos

- Node.js e npm para executar ou compilar a partir do código.
- Linux com bibliotecas do Electron para executar as versões Linux; Windows para executar o instalador Windows.

## Executar a partir do código

```bash
npm ci
npm start
```

Para rodar a suíte automatizada:

```bash
npm test
```

## Compilar instaladores

```bash
npm run build:debian
npm run build:arch
npm run build:windows
```

Os arquivos gerados ficam em `dist/`. As configurações de build e ícones ficam em `build/`; testes automatizados em `test/`.

## Builds publicadas

Os instaladores históricos e atuais estão organizados em `release-assets/`, por versão (`v0.1.0` a `v0.1.9`). Eles são mantidos fora dos commits e enviados como anexos de Releases do GitHub, inclusive porque alguns arquivos ultrapassam o limite de tamanho de arquivos comuns do Git.

Consulte [PUBLISHING.md](PUBLISHING.md) para criar o repositório, enviar o código e publicar os instaladores. Para incluir builds futuras, copie os arquivos para a pasta da versão correspondente em `release-assets/` e execute `scripts/publish-releases.sh`.

## Instalar uma build

Baixe o instalador da versão desejada na página **Releases** do repositório e escolha o arquivo correspondente ao seu sistema:

- **Windows:** baixe `Isotopus-<versão>-setup-x64.exe`, abra o arquivo e siga o assistente. O instalador permite escolher a pasta e criar atalhos.
- **Debian ou Ubuntu:** baixe `Isotopus-<versão>-amd64.deb`, abra um terminal na pasta do download e rode `sudo apt install ./Isotopus-<versão>-amd64.deb`. O `apt` instala o pacote e tenta resolver as dependências.
- **Arch Linux:** baixe `Isotopus-<versão>-x64.pacman` e rode `sudo pacman -U ./Isotopus-<versão>-x64.pacman` no terminal, dentro da pasta do download.

Substitua `<versão>` pelo número publicado, como `0.1.9`. Nem toda versão tem instalador para todos os sistemas; use um arquivo que esteja anexado à Release daquela versão. O [CHANGELOG](CHANGELOG.md) resume as mudanças da versão mais recente; cada Release também apresenta as notas daquela versão.

### Sobre avisos de segurança

Estas builds de teste podem não ter assinatura digital de editor. No Windows, o SmartScreen pode informar que o editor é desconhecido ou que o arquivo foi baixado com pouca frequência; o antivírus também pode inspecionar instaladores Electron. Esses avisos, isoladamente, não confirmam que o arquivo é malicioso nem garantem que seja seguro. Baixe apenas pela página oficial de Releases deste projeto e confira o nome e a versão do arquivo. Se não reconhecer a origem ou o aviso indicar uma ameaça específica, cancele e não execute.

No Linux, o sistema pode pedir sua senha para instalar o pacote. Esse pedido é esperado para uma instalação do sistema; confira o nome do pacote e a versão no comando antes de confirmar. Se houver erro de dependência, use o gerenciador de pacotes indicado acima e não tente contornar o aviso removendo proteções do sistema.

O player mantém a biblioteca e a reprodução no computador. Quando você solicita uma busca de letra, metadados da faixa podem ser enviados ao [LRCLIB](https://lrclib.net/docs); buscas manuais abrem o navegador com título e artista para pesquisa.

## Licença

O pacote declara `UNLICENSED`. Nenhuma licença de código aberto foi adicionada; consulte o autor antes de reutilizar ou redistribuir o código fora das builds publicadas.
