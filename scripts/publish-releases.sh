#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
assets_root="$repo_root/release-assets"

for assets_dir in "$assets_root"/v*; do
  [[ -d "$assets_dir" ]] || continue
  tag="$(basename "$assets_dir")"
  shopt -s nullglob
  assets=("$assets_dir"/*.deb "$assets_dir"/*.pacman "$assets_dir"/*.exe)
  shopt -u nullglob
  ((${#assets[@]})) || continue

  if gh release view "$tag" >/dev/null 2>&1; then
    printf 'Atualizando anexos da Release %s\n' "$tag"
    gh release upload "$tag" "${assets[@]}" --clobber
  else
    printf 'Criando Release %s\n' "$tag"
    gh release create "$tag" "${assets[@]}" --title "Isótopus ${tag#v}" --generate-notes
  fi
done
