#!/usr/bin/env bash
# Records assets/demo.gif from real spidersan output in a throwaway repo.
#
#   npm run build
#   asciinema rec -q --overwrite --window-size 90x26 -c 'bash assets/demo.sh' assets/demo.cast
#   agg --font-size 16 --theme monokai --idle-time-limit 3 --last-frame-duration 4 assets/demo.cast assets/demo.gif
#
# Needs: asciinema 3, agg. Uses this checkout's dist/ build, not a global install.
set -euo pipefail

CLI="$(cd "$(dirname "$0")/.." && pwd)/dist/bin/spidersan.js"
spidersan() { node "$CLI" "$@"; }

# Isolate from the recording machine: no global ~/.spidersanrc, git config or
# session id leaks into the output.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home" GIT_CONFIG_GLOBAL=/dev/null SPIDERSAN_CORE_ONLY=1
unset CLAUDE_CODE_SESSION_ID SPIDERSAN_AGENT SPIDERSAN_SYNC_MODULE
mkdir -p "$HOME" "$WORK/app" && cd "$WORK/app"

# Off camera: a repo where alice and carol are already mid-branch.
{
  git init -q -b main
  git config user.name demo && git config user.email demo@example.com
  mkdir -p src/ui && touch src/auth.ts src/api.ts src/ui/button.tsx && git add -A && git commit -qm init
  spidersan init
  git switch -qc alice/login  && echo '// login' >> src/auth.ts && git commit -qam login
  spidersan register --files src/auth.ts,src/api.ts --agent alice
  git switch -q main
  git switch -qc carol/theme  && echo '// theme' >> src/ui/button.tsx && git commit -qam theme
  spidersan register --files src/ui/button.tsx --agent carol
  git switch -q main
  git switch -qc bob/session  && echo '// session' >> src/auth.ts && echo '// x' >> src/ui/button.tsx && git commit -qam session
} >/dev/null 2>&1

type_cmd() {  # print "$ cmd" one character at a time, then run it
  printf '\033[1;32mbob/session\033[0m $ '
  local s="$*" i
  for ((i = 0; i < ${#s}; i++)); do printf '%s' "${s:i:1}"; sleep 0.04; done
  sleep 0.4; printf '\n'
  eval "$s" || true
  sleep 2.5
}

printf '\033[2m# bob starts a branch. alice and carol are already working.\033[0m\n'; sleep 1.5
type_cmd 'spidersan register --files src/auth.ts,src/ui/button.tsx --agent bob'
type_cmd 'spidersan conflicts'
type_cmd 'spidersan ready-check'
sleep 1.5
