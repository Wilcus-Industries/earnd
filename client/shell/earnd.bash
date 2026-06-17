# earnd — terminal ad banner (bash). Sourced from ~/.bashrc by install.sh.
# Pins a one-line ad to the top row at each prompt. Server-authoritative billing
# lives in the `earnd` binary; this shim only triggers redraws and key/exit hooks.

[ -z "$PS1" ] && return            # interactive shells only
: "${EARND_BIN:=earnd}"
: "${EARND_API_BASE:=http://localhost:3000}"
export EARND_API_BASE

_earnd_render() {
  command "$EARND_BIN" render --surface=shell --width="${COLUMNS:-80}" --rows="${LINES:-24}" 2>/dev/null
}
_earnd_open() { command "$EARND_BIN" open >/dev/null 2>&1; }

# Draw on every prompt, preserving any existing PROMPT_COMMAND.
case ";${PROMPT_COMMAND};" in
  *";_earnd_render;"*) ;;
  *) PROMPT_COMMAND="_earnd_render${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac

shopt -s checkwinsize 2>/dev/null  # keep $LINES/$COLUMNS current
trap '_earnd_render' WINCH         # re-pin row 1 on resize
trap 'command "$EARND_BIN" reset 2>/dev/null' EXIT  # release margins on exit (ConPTY safety)

# Ctrl-G opens the current ad in the browser.
bind -x '"\C-g":_earnd_open' 2>/dev/null

# `clear` / Ctrl-L wipe the screen below the banner instead of erasing row 1.
clear() { command "$EARND_BIN" clear 2>/dev/null; }
bind -x '"\C-l":clear' 2>/dev/null
