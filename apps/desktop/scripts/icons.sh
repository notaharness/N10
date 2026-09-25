#!/bin/sh
# Renders build/icon.svg, the n10 mark, into the PNGs electron-builder
# packages: build/icon.png and a size set in build/icons/ for Linux.
# Needs Inkscape. Run after changing the mark and commit the output.
set -eu
build="$(dirname "$0")/../build"
render() {
  inkscape "$build/icon.svg" --export-type=png \
    --export-width="$1" --export-height="$1" --export-filename="$2"
}
render 1024 "$build/icon.png"
for size in 16 24 32 48 64 128 256 512; do
  render "$size" "$build/icons/${size}x${size}.png"
done
