#!/usr/bin/env bash
set -euo pipefail

BURO_ROOT=${BURO_ROOT:-$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")}
PACK_DIR=${PACK_DIR:-/tmp/opencodez}
BURO_SERVER_HOST=${BURO_SERVER_HOST:-$(hostname -s)}
BURO_API_PORT=${BURO_API_PORT:-8765}
BURO_INSTANCE_ROOT=${BURO_INSTANCE_ROOT:-$(dirname "$BURO_ROOT")}

if [ ! -d "$BURO_ROOT/.git" ]; then
  printf 'Politia deployment requires the BURO source checkout: %s\n' "$BURO_ROOT" >&2
  exit 1
fi

discover_workers() {
  command -v buro >/dev/null 2>&1 || return 0
  while read -r _ host _; do
    if [ -n "$host" ] && [ "$host" != "$BURO_SERVER_HOST" ]; then
      printf '%s ' "$host"
    fi
  done < <(buro list host)
}

BURO_WORKER_HOSTS=${BURO_WORKER_HOSTS:-$(discover_workers)}

sync_workers=1
restart_api=1
dry_run=${BURO_DEPLOY_DRY_RUN:-0}
deployed_workers=()
unavailable_workers=()
failed_workers=()
api_stopped=0
tarball=""

restore_api() {
  if [ "$api_stopped" -eq 1 ] && [ "$dry_run" -eq 0 ]; then
    systemctl --user restart buro-api.service || true
  fi
}

finish() {
  restore_api
  if [ "$dry_run" -eq 0 ] && [ -n "$tarball" ]; then
    rm -f "$tarball"
  fi
}

trap finish EXIT

usage() {
  cat <<'EOF'
Usage: scripts/deploy-live.sh [options]

Build and deploy BURO live runtime from the canonical source tree.

Options:
  --skip-workers     Do not install the package on worker hosts
  --skip-api-restart Do not restart buro-api.service on the central host
  --dry-run          Print commands without executing them
  -h, --help         Show this help

Environment:
  BURO_ROOT          Source tree, default parent of this script directory
  PACK_DIR           Tarball output dir, default /tmp/opencodez
  BURO_WORKER_HOSTS  Space-separated workers, default from `buro list host`
  BURO_SERVER_HOST   Central API hostname, default current short hostname
  BURO_API_PORT      Central API port, default 8765
  BURO_INSTANCE_ROOT Central instance root, default parent of BURO_ROOT
  BURO_DEPLOY_DRY_RUN Set to 1 to print commands without executing them
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-workers) sync_workers=0 ;;
    --skip-api-restart) restart_api=0 ;;
    --dry-run) dry_run=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

log() {
  printf '\n==> %s\n' "$*"
}

run() {
  printf '+ '
  printf '%q ' "$@"
  printf '\n'
  if [ "$dry_run" -eq 0 ]; then
    "$@"
  fi
}

run_shell() {
  printf '+ %s\n' "$*"
  if [ "$dry_run" -eq 0 ]; then
    bash -lc "$*"
  fi
}

require_file() {
  if [ ! -f "$1" ]; then
    printf 'missing required file: %s\n' "$1" >&2
    exit 1
  fi
}

cd "$BURO_ROOT"
require_file package.json

package_name=$(node -p "const p=require('./package.json'); p.name + '-' + p.version + '.tgz'")
tarball="$PACK_DIR/$package_name"
node_bin_dir=$(dirname "$(command -v node)")
sudo_node_path="$node_bin_dir:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

log "pack"
run mkdir -p "$PACK_DIR"
run npm pack --pack-destination "$PACK_DIR"
if [ "$dry_run" -eq 0 ]; then
  require_file "$tarball"
fi

log "install on central live runtime"
central_config=$(printf '{"mode":"central","preset":"politia","current_context":"%s","central_host":"%s","api_url":"http://127.0.0.1:%s","instance_root":"%s"}' \
  "$BURO_SERVER_HOST" "$BURO_SERVER_HOST" "$BURO_API_PORT" "$BURO_INSTANCE_ROOT")
run mkdir -p "$HOME/.config/buro"
run_shell "umask 077 && printf '%s\\n' '$central_config' > '$HOME/.config/buro/config.json'"
run sudo -n env "PATH=$sudo_node_path" npm install -g "$tarball" --prefix /usr/local

if [ "$restart_api" -eq 1 ]; then
  log "back up central SQLite and restart live API"
  run env BURO_MODE=local BURO_PRESET=politia "BURO_CURRENT_CONTEXT=$BURO_SERVER_HOST" buro backup
  run systemctl --user stop buro-api.service
  api_stopped=1
  run systemctl --user restart buro-api.service
  api_stopped=0
  run systemctl --user is-active buro-api.service
fi

if [ "$sync_workers" -eq 1 ]; then
  log "install on worker hosts"
  for host in $BURO_WORKER_HOSTS; do
    if [ "$dry_run" -eq 0 ] && ! ssh -o BatchMode=yes -o ConnectTimeout=3 "$host" true; then
      log "worker unavailable, skipped: $host"
      unavailable_workers+=("$host")
      continue
    fi
    if ! run scp "$tarball" "$host:/tmp/$package_name"; then
      failed_workers+=("$host")
      continue
    fi
    if ! run ssh "$host" "sudo -n npm install -g /tmp/$package_name --prefix /usr"; then
      failed_workers+=("$host")
      continue
    fi
    if ! run ssh "$host" rm -f "/tmp/$package_name"; then
      failed_workers+=("$host")
      continue
    fi
    if [ "$dry_run" -eq 0 ]; then
      if ! remote_home=$(ssh "$host" 'printf %s "$HOME"'); then
        failed_workers+=("$host")
        continue
      fi
    else
      remote_home="~"
    fi
    client_config=$(printf '{"mode":"client","current_context":"%s","central_host":"%s","api_url":"http://%s:%s","instance_root":"%s/politia"}' \
      "$host" "$BURO_SERVER_HOST" "$BURO_SERVER_HOST" "$BURO_API_PORT" "$remote_home")
    if ! run ssh "$host" "mkdir -p ~/.config/buro && umask 077 && printf '%s\\n' '$client_config' > ~/.config/buro/config.json"; then
      failed_workers+=("$host")
      continue
    fi
    deployed_workers+=("$host")
  done
fi

log "verify live packet format"
run_shell "BURO_MODE=local BURO_PRESET=politia BURO_CURRENT_CONTEXT=$BURO_SERVER_HOST buro buro | grep -E 'BURO Entity:|Context:'"
run_shell "BURO_MODE=client BURO_CURRENT_CONTEXT=worker BURO_CENTRAL_HOST=$BURO_SERVER_HOST BURO_API_URL=http://127.0.0.1:$BURO_API_PORT buro buro | grep -E 'BURO Entity:|Context:'"
run_shell "BURO_MODE=local BURO_PRESET=politia BURO_CURRENT_CONTEXT=$BURO_SERVER_HOST buro $BURO_SERVER_HOST | grep -E 'BURO Entity:|Context:'"

if [ "$sync_workers" -eq 1 ]; then
  for host in "${deployed_workers[@]}"; do
    run_shell "ssh $host 'buro buro | grep -E '\''BURO Entity:|Context:'\'''"
  done
fi

if [ "${#unavailable_workers[@]}" -gt 0 ]; then
  log "workers left unchanged: ${unavailable_workers[*]}"
fi

if [ "${#failed_workers[@]}" -gt 0 ]; then
  printf 'worker deployment failed: %s\n' "${failed_workers[*]}" >&2
  exit 1
fi

log "BURO live deploy ok"
