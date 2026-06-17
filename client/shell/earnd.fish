# earnd — terminal ad banner (fish). Sourced from ~/.config/fish/config.fish.
# Pins a one-line ad to the top row at each prompt; the `earnd` binary owns all
# networking + server-authoritative billing.

status is-interactive; or exit 0
if not set -q EARND_BIN
    set -g EARND_BIN earnd
end
if not set -q EARND_API_BASE
    set -gx EARND_API_BASE "https://earnd.net"
end

function _earnd_render --on-event fish_prompt
    command $EARND_BIN render --surface=shell --width=$COLUMNS --rows=$LINES 2>/dev/null
end

function _earnd_winch --on-signal WINCH      # re-pin row 1 on resize
    _earnd_render
end

function _earnd_reset --on-event fish_exit   # release margins on exit (ConPTY safety)
    command $EARND_BIN reset 2>/dev/null
end

# Ctrl-G opens the current ad in the browser.
function _earnd_open
    command $EARND_BIN open >/dev/null 2>&1
end
bind \cg _earnd_open
