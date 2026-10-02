#!/usr/bin/env bash
# End-to-end check of a built self-hosted image, run by CI before anything is
# published: boots it on a fresh volume, runs the seeded "Hello Stage" template
# to COMPLETED (API + Postgres + Inngest), and round-trips a file through the
# /storage proxy (MinIO).
#
# Usage: docker/app/smoke-test.sh <image> [port]
# Needs: docker, curl, jq.
set -euo pipefail

image="${1:?usage: smoke-test.sh <image> [port]}"
port="${2:-18080}"
name="reelcraft-smoke-$$"
volume="${name}-data"
base="http://127.0.0.1:${port}"
api="${base}/api"
work="$(mktemp -d)"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "::group::container logs"
    docker logs "$name" 2>&1 | tail -200 || true
    echo "::endgroup::"
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

step() { echo "==> $*"; }
fail() {
  echo "smoke test failed: $*" >&2
  exit 1
}
post() { curl -fsS -H 'content-type: application/json' -X POST "$1" -d "$2"; }

step "starting $image on port $port"
docker run -d --name "$name" -p "127.0.0.1:${port}:8080" -v "${volume}:/data" "$image" >/dev/null

step "waiting for the API to report healthy"
for _ in $(seq 1 150); do
  if health="$(curl -fsS "${api}/system/health" 2>/dev/null)"; then break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then
    fail "container exited during startup"
  fi
  sleep 2
done
[ -n "${health:-}" ] || fail "API not healthy after 5 minutes"
echo "    $health"

step "serving the web app"
curl -fsS "${base}/" | grep -q '<div id="root">' || fail "web app index not served"

step "running the Hello Stage template"
channel="$(post "${api}/channels" '{"name":"Smoke test"}' | jq -r .id)"
template="$(curl -fsS "${api}/templates" | jq -r '[.[] | select(.name == "Hello Stage")][0].id')"
[ "$template" != null ] || fail "Hello Stage template not seeded"
version="$(post "${api}/templates/${template}/instantiate" \
  "{\"channelId\":\"${channel}\",\"runCapUsd\":1}" | jq -r .id)"
run="$(post "${api}/runs" \
  "{\"channelId\":\"${channel}\",\"blueprintVersionId\":\"${version}\",\"budgetCapUsd\":1}" | jq -r .id)"
post "${api}/runs/${run}/start" '{}' >/dev/null
state=""
for _ in $(seq 1 60); do
  state="$(curl -fsS "${api}/runs/${run}" | jq -r .state)"
  case "$state" in
    COMPLETED) break ;;
    FAILED | CANCELLED) fail "run ended in ${state}" ;;
  esac
  sleep 2
done
[ "$state" = COMPLETED ] || fail "run stuck in ${state} after 2 minutes"
echo "    run ${run} COMPLETED"

step "round-tripping a file through /storage"
# A valid 1x1 PNG, so the asset passes any image checks.
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==' |
  base64 -d >"${work}/in.png"
upload="$(post "${api}/channels/${channel}/assets/upload" '{"ext":"png"}')"
upload_url="$(jq -r .uploadUrl <<<"$upload")"
case "$upload_url" in /storage/*) ;; *) fail "upload URL is not app-relative: ${upload_url}" ;; esac
curl -fsS -X PUT -H 'content-type: image/png' --data-binary "@${work}/in.png" "${base}${upload_url}" >/dev/null
sha="$(sha256sum "${work}/in.png" | cut -d' ' -f1)"
post "${api}/channels/${channel}/assets" "$(jq -n --argjson u "$upload" --arg sha "$sha" \
  '{name:"smoke", kind:"media.image", blobId:$u.blobId, objectKey:$u.objectKey, sha256:$sha}')" >/dev/null
curl -fsSL -o "${work}/out.png" "${api}/blobs/$(jq -r .blobId <<<"$upload")"
cmp -s "${work}/in.png" "${work}/out.png" || fail "downloaded file differs from upload"

step "smoke test passed"
