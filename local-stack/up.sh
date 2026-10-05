#!/usr/bin/env bash
# Bring up the FULLY OFFLINE local stack for marketing-agents-web.
#
#   ./local-stack/up.sh            # start everything, seed it, print the URL
#   ./local-stack/up.sh --reset    # throw the local database away first
#   ./local-stack/up.sh down       # stop everything
#   ./local-stack/up.sh status     # what is running, and the whoami it answers
#   ./local-stack/up.sh token      # a bearer token, for curl
#   ./local-stack/up.sh logs tenant
#
# Nothing here touches production. The backend is this laptop's sqlite.
#
# WHAT IT NEEDS THAT IS NOT IN THIS REPO: the tenant BACKEND. This app is an
# app-UI; the Django service behind /api/* is `tenant-starter`, which lives in
# the start-simpli-api repo. That is not a packaging oversight that could be
# fixed by vendoring something — the tenant image lives in a private ECR and its
# two python dependencies are not on any public index — so the local stack needs
# that checkout, and says so plainly rather than failing obscurely.
#
# Point START_SIMPLI_API_DIR at it if it is not where this expects:
#   START_SIMPLI_API_DIR=~/src/start-simpli-api ./local-stack/up.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORK_ROOT="$(cd "$HERE/.." && pwd)"

# The two places a StartSimpli checkout normally sits: the meta-repo's submodule,
# and a standalone clone beside this one.
for candidate in \
  "${START_SIMPLI_API_DIR:-}" \
  "$HOME/Repos/start-simpli/start-simpli-api" \
  "$(dirname "$FORK_ROOT")/start-simpli-api" \
  "$(dirname "$FORK_ROOT")/start-simpli/start-simpli-api"
do
  [ -n "$candidate" ] || continue
  if [ -f "$candidate/tenant-starter/local-stack/stack.sh" ]; then
    API_DIR="$(cd "$candidate" && pwd)"; break
  fi
done

if [ -z "${API_DIR:-}" ]; then
  cat >&2 <<EOF
error: could not find start-simpli-api, which holds the tenant backend.

  git clone git@github.com:qosha1/start-simpli-api.git
  START_SIMPLI_API_DIR=\$PWD/start-simpli-api ./local-stack/up.sh

Looked in: \${START_SIMPLI_API_DIR:-(unset)}, ~/Repos/start-simpli/start-simpli-api,
$(dirname "$FORK_ROOT")/start-simpli-api, $(dirname "$FORK_ROOT")/start-simpli/start-simpli-api
(each must contain tenant-starter/local-stack/stack.sh — an older checkout will
not have it; 'git pull' there.)
EOF
  exit 1
fi

# Subcommand first, so `up.sh down` and `up.sh --reset` both read naturally.
CMD=up
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then CMD="$1"; shift; fi

exec "$API_DIR/tenant-starter/local-stack/stack.sh" "$CMD" \
  --config "$HERE/stack.env" "$@"
