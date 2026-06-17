# earnd — terminal ad banner (zsh). Sourced from ~/.zshrc by install.sh.
# Pins a one-line ad to the top row at each prompt. The `earnd` binary owns all
# networking + server-authoritative billing; this shim only triggers redraws.

[[ -o interactive ]] || return
: "${EARND_BIN:=earnd}"
: "${EARND_API_BASE:=http://localhost:3000}"
export EARND_API_BASE

_earnd_render() {
  command "$EARND_BIN" render --surface=shell --width="${COLUMNS:-80}" --rows="${LINES:-24}" 2>/dev/null
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd _earnd_render          # draw before each prompt

TRAPWINCH() { _earnd_render }               # re-pin row 1 on resize

_earnd_reset() { command "$EARND_BIN" reset 2>/dev/null }
add-zsh-hook zshexit _earnd_reset           # release margins on exit (ConPTY safety)

# Ctrl-G opens the current ad in the browser.
_earnd_open() { command "$EARND_BIN" open >/dev/null 2>&1; zle reset-prompt }
zle -N _earnd_open
bindkey '^g' _earnd_open

# `clear` / Ctrl-L wipe the screen below the banner instead of erasing row 1.
_earnd_clear() { command "$EARND_BIN" clear 2>/dev/null }
clear() { _earnd_clear }                                    # the `clear` command
_earnd_clear_widget() { _earnd_clear; zle reset-prompt }    # Ctrl-L
zle -N _earnd_clear_widget
bindkey '^l' _earnd_clear_widget
