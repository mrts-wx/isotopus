# Publicar o Isótopus no GitHub

Este diretório já contém o código, o histórico local com tags `v0.1.0` até `v0.1.9` e os instaladores disponíveis, separados por versão em `release-assets/`.

## Conectar a conta e publicar tudo

Instale o GitHub CLI (`gh`) se ainda não estiver instalado: <https://github.com/cli/cli#installation>. O login pode ser feito em qualquer pasta:

```bash
gh auth login
```

Depois entre na pasta do projeto. O comando `gh repo create` exige que você indique a visibilidade quando o terminal não está interativo. Escolha **uma** destas opções:

```bash
cd "/home/omartinss/Documentos/Isotopus Versions/Isotopus-GitHub"
gh repo create isotopus --source=. --remote=origin --push --public && git push origin --tags && ./scripts/publish-releases.sh
```

Para manter o repositório privado, use o mesmo comando trocando `--public` por `--private`. O fluxo cria o repositório, envia a branch `main` e o histórico, publica as tags antigas e atuais e cria uma Release por versão com os instaladores disponíveis. `gh auth status` mostra a conta conectada.

## Adicionar builds futuras

1. Crie uma pasta com a tag da versão, por exemplo `release-assets/v0.1.10/`.
2. Copie para ela os instaladores `.deb`, `.pacman` e/ou `.exe` dessa versão.
3. Faça commit das alterações no código e crie/envie a tag:

   ```bash
   git add -A
   git commit -m "release: Isótopus 0.1.10"
   git tag -a v0.1.10 -m "Isótopus 0.1.10"
   git push origin main --tags
   ```

4. Publique ou atualize os anexos:

   ```bash
   ./scripts/publish-releases.sh
   ```

O script cria Releases que ainda não existem e anexa ou substitui os arquivos das Releases existentes. Os binários ficam fora dos commits Git e são enviados como anexos de Release.

## Notas

- Os instaladores não são enviados ao histórico Git, pois alguns passam do limite de 100 MiB para arquivos comuns do GitHub. Releases aceitam anexos de até 2 GiB por arquivo.
- O envio inicial inclui builds disponíveis para as versões 0.1.0 a 0.1.9; algumas versões não têm pacote para todos os sistemas.
- O projeto declara `UNLICENSED`; nenhuma licença de código aberto foi adicionada.
