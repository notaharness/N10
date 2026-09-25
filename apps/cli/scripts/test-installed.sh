#!/usr/bin/env bash
# Installs a packed @notaharness/n10 tarball globally into a scratch prefix
# and runs the installed `n10` the way a user would: nothing from the
# workspace is on the module path, so a missing file in `files`, a broken
# manifest or a chunk that only loads inside the monorepo fails here.
#
#   apps/cli/scripts/test-installed.sh path/to/notaharness-n10-X.Y.Z.tgz
#
# Needs git, tmux, Xvfb and xwininfo, and node-pty's native build tools.
# Everything runs under a scratch HOME with its own tmux socket directory.
set -euo pipefail

tarball=$(realpath "$1")
scratch=$(mktemp -d)
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill -- "-$pid" 2>/dev/null || true; done
  rm -rf "$scratch"
}
trap cleanup EXIT

# Ink paints nothing under these, and TMUX would override TMUX_TMPDIR.
unset CI CONTINUOUS_INTEGRATION GITHUB_ACTIONS TMUX
export HOME="$scratch/home" TMUX_TMPDIR="$scratch/tmux"
mkdir -p "$HOME" "$TMUX_TMPDIR"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Polls `$1` (a shell condition) once a second for `$2` seconds.
wait_for() {
  for _ in $(seq "$2"); do
    eval "$1" && return 0
    sleep 1
  done
  return 1
}

echo "== npm install -g $tarball"
npm install -g --prefix "$scratch/prefix" "$tarball"
export PATH="$scratch/prefix/bin:$PATH"

repo="$scratch/repo"
git init -q -b main "$repo"
git -C "$repo" -c user.name=n10 -c user.email=n10@example.invalid \
  commit -q --allow-empty -m init
cd "$repo"

echo "== n10 --version"
expected=$(tar -xOzf "$tarball" package/package.json |
  node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
actual=$(n10 --version)
[ "$actual" = "$expected" ] || fail "--version printed '$actual', not '$expected'"

echo "== n10 util add-comment"
status=0
n10 util add-comment 2>"$scratch/util.err" || status=$?
[ "$status" -eq 1 ] || fail "util add-comment exited $status, not 1"
grep -q 'Usage: n10 util add-comment' "$scratch/util.err" ||
  fail "util add-comment printed no usage: $(cat "$scratch/util.err")"

echo "== n10 --tui"
tmux new-session -d -s tui -x 160 -y 48 \
  "n10 --tui 2>'$scratch/tui.err'; echo \$? >'$scratch/tui.status'"
wait_for "tmux capture-pane -p -t tui 2>/dev/null | grep -q 'no sessions'" 30 ||
  fail "the TUI did not render: $(cat "$scratch/tui.err")"
tmux send-keys -t tui q
wait_for "[ -s '$scratch/tui.status' ]" 15 || fail "the TUI did not quit on q"
[ "$(cat "$scratch/tui.status")" = 0 ] ||
  fail "the TUI exited $(cat "$scratch/tui.status"): $(cat "$scratch/tui.err")"

echo "== n10 (desktop under Xvfb)"
export DISPLAY=:99
setsid Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp &
pids+=($!)
wait_for 'xwininfo -root >/dev/null 2>&1' 10 || fail "Xvfb did not start"
setsid n10 >"$scratch/desktop.log" 2>&1 &
pids+=($!)
# The desktop records the repository it opened at startup, and the window
# takes the renderer's <title> once the page has loaded.
recents="$HOME/.n10/desktop-recents.json"
opened() { grep -qF "\"$(realpath "$repo")\"" "$recents" 2>/dev/null; }
wait_for opened 60 ||
  fail "the desktop did not open $repo: $(cat "$scratch/desktop.log")"
wait_for "xwininfo -root -tree | grep -q '\"n10\"'" 60 ||
  fail "the desktop window did not load: $(cat "$scratch/desktop.log")"

echo "OK: the installed n10 $actual runs"
