# shellcheck shell=bash
# Sourced by every s6 service. Loads the secrets generated on first boot and
# derives connection settings from them. Variables the user already set on
# the container (`docker run -e ...`) always win.

REELCRAFT_SECRETS_FILE=/data/secrets.env

if [ -f "$REELCRAFT_SECRETS_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in '' | \#*) continue ;; esac
    if [ -z "${!key+x}" ]; then export "$key=$value"; fi
  done < "$REELCRAFT_SECRETS_FILE"
fi

: "${DATABASE_URL:=postgres://reelcraft:${REELCRAFT_PG_PASSWORD}@127.0.0.1:5432/reelcraft}"
: "${INNGEST_DATABASE_URL:=postgres://reelcraft:${REELCRAFT_PG_PASSWORD}@127.0.0.1:5432/inngest?sslmode=disable}"
: "${S3_ACCESS_KEY_ID:=${REELCRAFT_MINIO_USER}}"
: "${S3_SECRET_ACCESS_KEY:=${REELCRAFT_MINIO_PASSWORD}}"
export DATABASE_URL INNGEST_DATABASE_URL S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY

export PGHOST=/run/postgresql PGUSER=reelcraft
export HOME=/home/reelcraft

# Blocks until a TCP/HTTP dependency answers, so services start in order even
# though s6 only knows when a process was launched, not when it is ready.
reelcraft_wait() {
  local name="$1" seconds="$2"
  shift 2
  for _ in $(seq 1 "$seconds"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "reelcraft: ${name} did not become ready within ${seconds}s" >&2
  return 1
}

# Points REELCRAFT_APP_DIR, REELCRAFT_VERSION and WEB_DIST_DIR at the app
# bundle to run: an in-app update when one is installed, otherwise the
# image's own. The image's version stays in REELCRAFT_IMAGE_VERSION.
reelcraft_select_app() {
  local exports
  exports="$(node /usr/local/lib/reelcraft/updater/select-app.mjs)"
  eval "$exports"
}
