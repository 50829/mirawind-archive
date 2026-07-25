#!/usr/bin/env bash

set -euo pipefail

script_directory="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
repository_root="$(
  CDPATH= cd -- "${script_directory}/.." >/dev/null 2>&1
  pwd
)"
environment_file="${repository_root}/.env"
base_compose="${repository_root}/docker/compose.yaml"
local_compose="${repository_root}/docker/compose.local.yaml"
project_name="mirawind-local"
secret_generator_image="node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d"

fail() {
  printf 'Mirawind local Docker: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    fail "required command not found: $1"
}

require_docker() {
  require_command docker
  docker info >/dev/null 2>&1 ||
    fail "the Docker daemon is not available"
  docker compose version >/dev/null 2>&1 ||
    fail "the Docker Compose plugin is not available"
}

compose() {
  docker compose \
    --project-name "${project_name}" \
    --env-file "${environment_file}" \
    --file "${base_compose}" \
    --file "${local_compose}" \
    "$@"
}

create_environment() {
  if [[ -f "${environment_file}" ]]; then
    if ! grep -Eq '^MIRAWIND_AUTH_SECRET=.{32,}$' "${environment_file}"; then
      fail ".env exists but MIRAWIND_AUTH_SECRET is missing or shorter than 32 characters"
    fi
    if grep -Fq 'MIRAWIND_AUTH_SECRET=replace-with-at-least-32-random-bytes' \
      "${environment_file}"; then
      fail ".env still contains the example authentication secret"
    fi
    return
  fi

  local authentication_secret
  if ! authentication_secret="$(
    docker run --rm --network none "${secret_generator_image}" \
      node --input-type=module --eval \
      'import { randomBytes } from "node:crypto";
       process.stdout.write(randomBytes(48).toString("base64"));'
  )"; then
    fail "could not generate the authentication secret with Docker"
  fi
  umask 077
  {
    printf '%s\n' 'MIRAWIND_DATA_DIR=/var/lib/mirawind'
    printf '%s\n' 'MIRAWIND_PUBLIC_ORIGIN=http://localhost:4321'
    printf '%s\n' 'MIRAWIND_PASSKEY_RP_ID=localhost'
    printf '%s\n' 'MIRAWIND_ALLOWED_HOSTS=localhost,127.0.0.1'
    printf 'MIRAWIND_AUTH_SECRET=%s\n' "${authentication_secret}"
  } >"${environment_file}"
  chmod 0600 "${environment_file}"
  unset authentication_secret
  printf 'Created private local configuration at %s\n' "${environment_file}"
}

administrator_exists() {
  compose run --rm --no-deps --entrypoint node web \
    --input-type=module \
    --eval '
      import Database from "better-sqlite3";
      const database = new Database(
        "/var/lib/mirawind/db/mirawind.sqlite",
        { fileMustExist: true, readonly: true },
      );
      const row = database
        .prepare("SELECT admin_user_id FROM installation WHERE id = 1")
        .get();
      database.close();
      process.exit(row?.admin_user_id ? 0 : 1);
    ' >/dev/null 2>&1
}

bootstrap_administrator() {
  if administrator_exists; then
    return
  fi
  [[ -t 0 && -t 1 ]] ||
    fail "first start requires an interactive terminal for administrator setup"
  printf '%s\n' \
    'No administrator exists yet. Enter the local administrator details below.'
  compose run --rm --no-deps web \
    node dist/processes/cli/index.js admin bootstrap \
    --data-dir /var/lib/mirawind
}

start_stack() {
  require_docker
  create_environment

  compose build
  compose stop worker
  compose stop web
  compose run --rm data-init
  compose run --rm --no-deps migrate
  bootstrap_administrator
  compose up --detach --no-build --wait --wait-timeout 120 web worker

  printf '%s\n' \
    'Mirawind is ready at http://localhost:4321' \
    'Log in at http://localhost:4321/login'
}

usage() {
  cat <<'EOF'
Usage: ./docker/local.sh [up|status|logs|stop]

  up      Build, initialize when needed, and start Web + worker (default)
  status  Show local container health
  logs    Follow Web and worker logs
  stop    Stop worker, then Web; keep the persistent volume
EOF
}

action="${1:-up}"
case "${action}" in
  up)
    start_stack
    ;;
  status)
    require_docker
    create_environment
    compose ps
    ;;
  logs)
    require_docker
    create_environment
    compose logs --follow web worker
    ;;
  stop)
    require_docker
    create_environment
    compose stop worker
    compose stop web
    ;;
  help | --help | -h)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
