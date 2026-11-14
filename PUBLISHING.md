# Publicar Isótopus 0.2.0 no GitHub

O repositório existente é `mrts-wx/isotopus` e o remoto `origin` já está configurado. O fluxo abaixo publica somente a versão 0.2.0.

## 1. Conferir a conta e o remoto

No terminal, dentro de `Isotopus-GitHub`:

```bash
gh auth status
git remote -v
git status
```

A conta precisa ter permissão de escrita no repositório. O remoto deve apontar para `https://github.com/mrts-wx/isotopus.git`.

## 2. Gerar os instaladores

Com Node.js/npm instalados e dependências baixadas (`npm ci`):

```bash
npm run build:debian
npm run build:arch
npm run build:windows
```

Os arquivos devem aparecer em `dist/`:

- `Isotopus-0.2.0-amd64.deb` — Debian/Ubuntu x64.
- `Isotopus-0.2.0-x64.pacman` — Arch Linux x64.
- `Isotopus-0.2.0-setup-x64.exe` — Windows x64.

## 3. Preparar a versão e publicar o código

Copie os três instaladores para `release-assets/v0.2.0/` e confirme também o changelog. Essa pasta é ignorada pelo Git; os binários serão anexados à Release no passo 4. Confira primeiro se os arquivos listados abaixo são as alterações que você quer publicar:

```bash
git add CHANGELOG.md README.md PUBLISHING.md Discord-description.txt app.js main.js preload.js index.html features.css home-player.css lyrics.css lyrics.js lyrics-worker.cjs package.json package-lock.json scripts/generate-icon.py scripts/patch-transformers-electron.js sharp-stub.mjs build/icons test/app.test.js
git diff --cached --check
git diff --cached --stat
git commit -m "release: Isótopus 0.2.0"
git tag -a v0.2.0 -m "Isótopus 0.2.0"
git push origin main --follow-tags
```

Revise a saída do `git diff --cached --stat` antes de confirmar o commit. Se o commit/tag já tiver sido criado, confira com `git status` e `git tag --list v0.2.0`; não crie uma segunda tag com o mesmo nome. Se o push avisar que a branch remota avançou, integre as mudanças remotas antes de tentar novamente.

## 4. Criar a Release e anexar os pacotes

A partir da raiz do repositório:

```bash
gh release create v0.2.0 \
  release-assets/v0.2.0/Isotopus-0.2.0-amd64.deb \
  release-assets/v0.2.0/Isotopus-0.2.0-x64.pacman \
  release-assets/v0.2.0/Isotopus-0.2.0-setup-x64.exe \
  --repo mrts-wx/isotopus \
  --title "Isótopus 0.2.0" \
  --notes-file CHANGELOG.md
```

Se a Release já existir e você só precisar enviar ou substituir anexos:

```bash
gh release upload v0.2.0 \
  release-assets/v0.2.0/Isotopus-0.2.0-amd64.deb \
  release-assets/v0.2.0/Isotopus-0.2.0-x64.pacman \
  release-assets/v0.2.0/Isotopus-0.2.0-setup-x64.exe \
  --repo mrts-wx/isotopus --clobber
```

Abra `https://github.com/mrts-wx/isotopus/releases/tag/v0.2.0` e confira título, notas e os três arquivos antes de divulgar. O `.deb` é para Debian/Ubuntu, o `.pacman` para Arch e o `.exe` para Windows.

## Detalhes

- Os instaladores ficam fora do histórico Git; Releases aceitam anexos maiores que o limite usual de arquivos Git.
- O script `scripts/publish-releases.sh` percorre e atualiza todas as versões existentes em `release-assets/`. Para publicar só a 0.2.0, use os comandos acima.
- A build Windows não tem assinatura de código e pode exibir aviso do SmartScreen.
- O projeto declara `UNLICENSED`; nenhuma licença de código aberto foi adicionada.
