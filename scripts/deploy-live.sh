#!/usr/bin/env bash
set -euo pipefail

# Politia's Linux rollout. BURO_ROOT belongs to the instance, never the checkout.
source_root=${BURO_SOURCE_ROOT:-$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")}
sync_workers=1
dry_run=${BURO_DEPLOY_DRY_RUN:-0}
for option in "$@"; do
  case "$option" in
    --skip-workers) sync_workers=0 ;;
    --dry-run) dry_run=1 ;;
    -h|--help)
      printf '%s\n' 'Usage: scripts/deploy-live.sh [--skip-workers] [--dry-run]' \
        'Uses existing central and worker config.json files; never replaces them.' \
        'Environment: BURO_SOURCE_ROOT, PACK_DIR, BURO_WORKER_HOSTS, BURO_WORKER_PREFIX (default /usr), BURO_DEPLOY_DRY_RUN.'
      exit 0 ;;
    *) printf 'unsupported option: %s\n' "$option" >&2; exit 2 ;;
  esac
done
if [ ! -d "$source_root/.git" ]; then
  printf 'Politia deployment requires a BURO source checkout: %s\n' "$source_root" >&2
  exit 1
fi
cd "$source_root"
version=$(node -p "require('./package.json').version")
state_dir=$(node --input-type=module -e 'import {loadConfig} from "./src/config.js"; const c=loadConfig(); if(c.mode === "client") throw new Error("run deployment on the central host"); console.log(c.stateDir)')
database_path=$(node --input-type=module -e 'import {loadConfig} from "./src/config.js"; console.log(loadConfig().databasePath)')
server_host=$(node --input-type=module -e 'import {loadConfig} from "./src/config.js"; console.log(loadConfig().currentContext)')
api_url=$(node --input-type=module -e 'import {loadConfig} from "./src/config.js"; const u=new URL(loadConfig().apiUrl); u.hostname="127.0.0.1"; console.log(u.href.replace(/\/$/, ""))')
pack_dir=${PACK_DIR:-$state_dir/deployments/$version-$(date -u +%Y%m%dT%H%M%SZ)}
tarball="$pack_dir/buro-$version.tgz"
worker_prefix=${BURO_WORKER_PREFIX:-/usr}
if [[ ! "$worker_prefix" =~ ^/[a-zA-Z0-9_./-]+$ ]]; then printf 'Invalid worker prefix: %s\n' "$worker_prefix" >&2; exit 1; fi
node_bin_dir=$(dirname "$(command -v node)")
sudo_node_path="$node_bin_dir:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
previous_package=""
previous_snapshot=""
api_stopped=0
central_pending=0
unavailable_workers=()
failed_workers=()
deployed_workers=()

run() {
  printf '+ '; printf '%q ' "$@"; printf '\n'
  if [ "$dry_run" -eq 0 ]; then "$@"; fi
}

run_check() {
  printf '+ '; printf '%q ' "$@"; printf '\n'
  if [ "$dry_run" -eq 0 ]; then
    local output
    if ! output=$("$@" 2>&1); then printf '%s\n' "$output" >&2; return 1; fi
  fi
}

finish() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$central_pending" -eq 1 ]; then
    printf 'Central verification failed; restoring the previous package and snapshot.\n' >&2
    if systemctl --user stop buro-api.service; then
      api_stopped=1
      if sudo -n env "PATH=$sudo_node_path" npm install -g "$previous_package" --prefix /usr/local \
        && cp "$previous_snapshot" "$database_path"; then
        printf 'Previous installation restored.\n' >&2
      else
        printf 'Recovery failed; API left stopped. Package: %s; snapshot: %s\n' "$previous_package" "$previous_snapshot" >&2
        api_stopped=0
      fi
    else
      printf 'Could not stop API for recovery; installation left in place.\n' >&2
      api_stopped=0
    fi
  fi
  if [ "$api_stopped" -eq 1 ]; then systemctl --user restart buro-api.service || status=1; fi
  if [ "$dry_run" -eq 0 ] && [ -f "$tarball" ]; then
    # A durable continuation record, including interrupted rollouts.
    node --input-type=module - "$pack_dir/pending.json" "$tarball" "$status" "$previous_package" "$previous_snapshot" \
      "${unavailable_workers[*]}" "${failed_workers[*]}" "${deployed_workers[*]}" <<'JS'
import {writeFileSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [target, pkg, status, previous_package, previous_snapshot, offline, failed, deployed] = process.argv.slice(2);
const hosts = text => text ? text.split(' ') : [];
writeFileSync(target, JSON.stringify({package:pkg, sha256:createHash('sha256').update(readFileSync(pkg)).digest('hex'),
  status:Number(status), previous_package, previous_snapshot, unavailable:hosts(offline), failed:hosts(failed), deployed:hosts(deployed)}, null, 2)+'\n', {mode:0o600});
JS
    printf 'Package and rollout record retained: %s\n' "$pack_dir"
  fi
  exit "$status"
}
trap finish EXIT

workers=${BURO_WORKER_HOSTS:-$(buro list host --limit 1000)}
if [ -z "${BURO_WORKER_HOSTS:-}" ]; then
  worker_ids=()
  while read -r kind id _; do
    if [ "$kind" = host ] && [ "$id" != "$server_host" ]; then worker_ids+=("$id"); fi
  done <<< "$workers"
  workers="${worker_ids[*]}"
fi
for host in $workers; do
  if [[ ! "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
    printf 'Invalid SSH worker name: %s\n' "$host" >&2; exit 1
  fi
done

run env BURO_MODE=local node src/cli.js init --dry-run
run mkdir -p "$pack_dir"
run npm pack --pack-destination "$pack_dir"
if [ "$dry_run" -eq 0 ]; then
  rollback_dir=$(mktemp -d "$pack_dir/rollback.XXXXXX")
  previous_name=$(npm pack /usr/local/lib/node_modules/buro --pack-destination "$rollback_dir" --quiet)
  previous_package="$rollback_dir/$previous_name"
  systemctl --user stop buro-api.service
  api_stopped=1
  snapshot_output=$(buro backup)
  snapshot_source=${snapshot_output#BURO backup created: }
  test -f "$snapshot_source"
  previous_snapshot="$rollback_dir/before.sqlite3"
  cp "$snapshot_source" "$previous_snapshot"
  central_pending=1
fi
run sudo -n env "PATH=$sudo_node_path" npm install -g "$tarball" --prefix /usr/local
run env BURO_MODE=local buro init
run systemctl --user restart buro-api.service
if [ "$dry_run" -eq 0 ]; then api_stopped=0; fi
run systemctl --user is-active buro-api.service
# Keep the rollback boundary open through actual CLI and HTTP verification.
run buro --version
run_check buro buro
run_check buro current --brief
run_check env BURO_MODE=client "BURO_API_URL=$api_url" buro buro
if [ "$dry_run" -eq 0 ]; then
  test "$(buro --version)" = "$version"
  node --input-type=module -e 'const r=await fetch(process.argv[1]+"/health", {signal:AbortSignal.timeout(3000)}); const h=await r.json(); if(!r.ok || !h.ok) throw new Error(JSON.stringify(h)); console.log("Central API healthy; records:", h.entity_count)' "$api_url"
  central_pending=0
fi
run buro connect opencodez

if [ "$sync_workers" -eq 1 ]; then
  for host in $workers; do
    if [ "$dry_run" -eq 0 ] && ! ssh -o BatchMode=yes -o ConnectTimeout=3 "$host" true; then
      unavailable_workers+=("$host")
      continue
    fi
    # Existing clients keep their instance/draft paths and endpoint settings.
    if ! run ssh "$host" 'test -f "$HOME/.config/buro/config.json"' \
      || ! run scp "$tarball" "$host:/tmp/buro-$version.tgz" \
      || ! run ssh "$host" "sudo -n npm install -g /tmp/buro-$version.tgz --prefix $worker_prefix" \
      || ! run_check ssh "$host" "test \"\$(buro --version)\" = '$version' && buro buro && buro current --brief && buro connect opencodez" \
      || ! run ssh "$host" rm -f "/tmp/buro-$version.tgz"; then
      failed_workers+=("$host")
      continue
    fi
    deployed_workers+=("$host")
  done
fi
if [ "${#unavailable_workers[@]}" -gt 0 ]; then printf 'Offline, pending: %s\n' "${unavailable_workers[*]}"; fi
if [ "${#failed_workers[@]}" -gt 0 ]; then printf 'Worker rollout failed: %s\n' "${failed_workers[*]}" >&2; exit 1; fi
printf 'BURO rollout verified%s.\n' "$([ "$dry_run" -eq 1 ] && printf ' (preview)' || true)"
