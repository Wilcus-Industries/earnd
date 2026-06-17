#!/usr/bin/env bash
# earnd installer — builds the banner client, wires it into your shell, and
# registers this device. Re-running is safe (idempotent managed block).
#
# Usage:
#   ./install.sh [--api-base URL] [--shell bash|zsh|fish] [--prefix DIR]
#
# What it sends (full disclosure, see Privacy in the plan):
#   • a per-install device id and your OS name (at registration)
#   • the surface type ("shell") and display-dwell liveness during sessions
# What it NEVER sends: command contents, keystrokes, cwd, environment, or any PII
# beyond the device id. The client is open source — read it before trusting it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_BASE="http://localhost:3000"  # override for prod: ./install.sh --api-base https://your-deploy
PREFIX="$HOME/.local/bin"
SHELL_NAME=""

while [ $# -gt 0 ]; do
  case "$1" in
    --api-base) API_BASE="$2"; shift 2 ;;
    --shell)    SHELL_NAME="$2"; shift 2 ;;
    --prefix)   PREFIX="$2"; shift 2 ;;
    -h|--help)  grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "earnd: unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Refuse a non-loopback api-base served over plaintext http: the device id,
# dashboard token, and impression traffic would travel in cleartext (CWE-319).
case "$API_BASE" in
  http://localhost*|http://127.0.0.1*|http://[::1]*|https://*) ;;
  http://*)
    echo "earnd: refusing plaintext --api-base '$API_BASE'. Use https:// for non-loopback hosts." >&2
    exit 2 ;;
  *)
    echo "earnd: --api-base must start with http:// (loopback only) or https://, got '$API_BASE'." >&2
    exit 2 ;;
esac

# Detect the shell from $SHELL if not given.
if [ -z "$SHELL_NAME" ]; then
  case "${SHELL##*/}" in
    zsh) SHELL_NAME=zsh ;;
    fish) SHELL_NAME=fish ;;
    *) SHELL_NAME=bash ;;
  esac
fi

echo "earnd installer"
echo "  api-base : $API_BASE"
echo "  shell    : $SHELL_NAME"
echo "  prefix   : $PREFIX"
echo

# 1. Build the static binary.
if ! command -v go >/dev/null 2>&1; then
  echo "earnd: Go toolchain not found. Install Go (https://go.dev/dl) and re-run." >&2
  exit 1
fi
mkdir -p "$PREFIX"
echo "Building earnd…"
( cd "$SCRIPT_DIR" && CGO_ENABLED=0 go build -o "$PREFIX/earnd" ./cmd/earnd )
echo "Installed $PREFIX/earnd"

# 2. Install the shim into the earnd config dir.
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/earnd"
mkdir -p "$CONF_DIR"
case "$SHELL_NAME" in
  bash) SHIM_SRC="$SCRIPT_DIR/shell/earnd.bash"; RC="$HOME/.bashrc" ;;
  zsh)  SHIM_SRC="$SCRIPT_DIR/shell/earnd.zsh";  RC="${ZDOTDIR:-$HOME}/.zshrc" ;;
  fish) SHIM_SRC="$SCRIPT_DIR/shell/earnd.fish"; RC="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish" ;;
  *) echo "earnd: unsupported shell '$SHELL_NAME'" >&2; exit 2 ;;
esac
SHIM_DST="$CONF_DIR/earnd.$SHELL_NAME"
cp "$SHIM_SRC" "$SHIM_DST"
mkdir -p "$(dirname "$RC")"
touch "$RC"

# 3. Add an idempotent managed block to the rc file.
BEGIN="# >>> earnd >>>"
END="# <<< earnd <<<"
if grep -qF "$BEGIN" "$RC"; then
  # Replace the existing block (portable: rewrite without the old block).
  awk -v b="$BEGIN" -v e="$END" '
    $0==b{skip=1} !skip{print} $0==e{skip=0}' "$RC" > "$RC.earnd.tmp"
  mv "$RC.earnd.tmp" "$RC"
fi
{
  echo "$BEGIN"
  if [ "$SHELL_NAME" = fish ]; then
    echo "set -gx EARND_BIN \"$PREFIX/earnd\""
    echo "set -gx EARND_API_BASE \"$API_BASE\""
    echo "source \"$SHIM_DST\""
  else
    echo "export EARND_BIN=\"$PREFIX/earnd\""
    echo "export EARND_API_BASE=\"$API_BASE\""
    echo "[ -f \"$SHIM_DST\" ] && source \"$SHIM_DST\""
  fi
  echo "$END"
} >> "$RC"
echo "Wired earnd into $RC"

# 4. Register this device (creates the keypair + publisher binding).
echo
EARND_API_BASE="$API_BASE" "$PREFIX/earnd" register || {
  echo "earnd: registration failed (is $API_BASE reachable?). You can re-run 'earnd register' later." >&2
}

# 5. Disclosure + PATH note.
echo
echo "Done. earnd will appear on row 1 in new shells (or run: source \"$RC\")."
echo "Toggle anytime:  earnd off   |   earnd on        Status: earnd status"
echo "Open the ad:     Ctrl-G"
case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *) echo "NOTE: $PREFIX is not on your PATH — add it so 'earnd' resolves." ;;
esac
