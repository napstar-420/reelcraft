#!/usr/bin/env bash
# End-to-end check of the in-app updater against a built image, run by CI
# after the smoke test. It publishes releases made from the image's own app
# bundle on a fake GitHub Releases API, signed with a throwaway key, then:
#
#   1. installs a good update (1.0.1) and expects it to become active, with
#      the data created before the update still there and runs still working;
#   2. installs a broken update (1.0.2, whose API crashes on start) and
#      expects an automatic rollback to 1.0.1 with the data intact.
#
# Usage: docker/app/update-test.sh <image> [port]
# Needs: docker, curl, jq, node, tar.
set -euo pipefail

image="${1:?usage: update-test.sh <image> [port]}"
port="${2:-18081}"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
name="reelcraft-update-$$"
volume="${name}-data"
test_image="reelcraft-update-test:$$"
base="http://127.0.0.1:${port}"
api="${base}/api"
work="$(mktemp -d)"
releases="${work}/releases"
fake_port=9999

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "::group::container logs"
    docker logs "$name" 2>&1 | tail -300 || true
    echo "::endgroup::"
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker rmi "$test_image" >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

step() { echo "==> $*"; }
fail() {
  echo "update test failed: $*" >&2
  exit 1
}
post() { curl -fsS -H 'content-type: application/json' -X POST "$1" -d "$2"; }

wait_healthy() {
  local want="$1" health=""
  for _ in $(seq 1 150); do
    health="$(curl -fsS "${api}/system/health" 2>/dev/null || true)"
    if [ "$(jq -r '.version // empty' <<<"$health" 2>/dev/null)" = "$want" ]; then return 0; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then
      fail "container exited"
    fi
    sleep 2
  done
  fail "API not healthy on ${want} after 5 minutes (last: ${health:-no answer})"
}

run_hello_stage() {
  local channel="$1" blueprint version run state=""
  blueprint="$(post "${api}/blueprints" \
    "{\"channelId\":\"${channel}\",\"name\":\"Hello ${RANDOM}${RANDOM}\"}" | jq -r .blueprintId)"
  version="$(post "${api}/blueprints/${blueprint}/versions" \
    "$(cat "${repo_root}/docker/app/hello-blueprint.json")" | jq -r .id)"
  run="$(post "${api}/runs" \
    "{\"channelId\":\"${channel}\",\"blueprintVersionId\":\"${version}\",\"budgetCapUsd\":1}" | jq -r .id)"
  post "${api}/runs/${run}/start" '{}' >/dev/null
  for _ in $(seq 1 60); do
    state="$(curl -fsS "${api}/runs/${run}" | jq -r .state)"
    case "$state" in
      COMPLETED) return 0 ;;
      FAILED | CANCELLED) fail "run ended in ${state}" ;;
    esac
    sleep 2
  done
  fail "run stuck in ${state}"
}

# Waits for the updater to record the outcome of installing $1, and prints it.
wait_result() {
  local want="$1" status=""
  for _ in $(seq 1 240); do
    status="$(curl -fsS "${api}/system/update" 2>/dev/null || true)"
    if [ "$(jq -r '.lastResult.to // empty' <<<"$status" 2>/dev/null)" = "$want" ] &&
      [ "$(jq -r '.phase' <<<"$status")" = idle ]; then
      jq -c .lastResult <<<"$status"
      return 0
    fi
    sleep 2
  done
  fail "no result for the update to ${want} after 8 minutes (last: ${status:-no answer})"
}

channel_exists() {
  curl -fsS "${api}/channels" | jq -e --arg id "$1" 'any(.[]; .id == $id)' >/dev/null
}

step "making a throwaway release signing key"
node --input-type=module -e "
  import { generateKeyPairSync } from 'node:crypto';
  import { writeFileSync } from 'node:fs';
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync('${work}/test.pub', publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync('${work}/test.key', privateKey.export({ type: 'pkcs8', format: 'pem' }));
"

step "building a test image that trusts it and reports version 1.0.0"
mkdir -p "${work}/image"
cp "${work}/test.pub" "${work}/image/release-signing.pub"
cat >"${work}/image/Dockerfile" <<EOF
FROM ${image}
COPY release-signing.pub /opt/reelcraft/release-signing.pub
ENV REELCRAFT_VERSION=1.0.0 REELCRAFT_IMAGE_VERSION=1.0.0 \\
    REELCRAFT_UPDATE_API=http://127.0.0.1:${fake_port} REELCRAFT_UPDATE_REPO=test/reelcraft \\
    REELCRAFT_UPDATE_TRIAL_TIMEOUT_SEC=120
EOF
docker build -q -t "$test_image" "${work}/image" >/dev/null

step "making releases from the image's app bundle"
arch="$(docker image inspect -f '{{.Architecture}}' "$image")"
runtime="$(docker run --rm --entrypoint cat "$image" /opt/reelcraft/RUNTIME_VERSION)"
cid="$(docker create "$image")"
mkdir -p "${work}/app" "$releases"
docker cp "${cid}:/opt/reelcraft/app/." "${work}/app"
docker rm "$cid" >/dev/null
make_release() {
  local version="$1" broken="${2:-}" out="${work}/bundle-$1"
  mkdir -p "$out"
  cp -a "${work}/app/." "$out"
  jq --arg v "$version" '.version = $v' "${work}/app/package.json" >"${out}/package.json"
  if [ -n "$broken" ]; then
    echo "throw new Error('this release is broken on purpose');" >"${out}/apps/api/dist/main.js"
  fi
  local stage="${work}/stage-${version}"
  mkdir -p "$stage"
  tar -C "$out" --owner=0 --group=0 --numeric-owner -czf \
    "${stage}/reelcraft-app-${version}-linux-${arch}.tar.gz" .
  rm -rf "$out"
  node "${repo_root}/scripts/release/build-manifest.mjs" --version "$version" --tag "v${version}" \
    --runtime "$runtime" --bundles-dir "$stage" --out "${stage}/reelcraft-${version}.manifest.json" >/dev/null
  RELEASE_SIGNING_KEY="$(cat "${work}/test.key")" RELEASE_SIGNING_PUBLIC_KEY_PATH="${work}/test.pub" \
    node "${repo_root}/scripts/release/sign-manifest.mjs" "${stage}/reelcraft-${version}.manifest.json" >/dev/null
}
# Publishes a release made by make_release on the fake API in the container.
publish() {
  docker cp "${work}/stage-$1/." "${name}:/tmp/releases/" >/dev/null
}
make_release 1.0.1
make_release 1.0.2 broken

step "starting the test image"
docker run -d --name "$name" -p "127.0.0.1:${port}:8080" -v "${volume}:/data" "$test_image" >/dev/null
wait_healthy 1.0.0
docker exec "$name" mkdir -p /tmp/releases
docker cp "${repo_root}/docker/app/test/fake-releases.mjs" "${name}:/tmp/fake-releases.mjs" >/dev/null
docker exec -d "$name" node /tmp/fake-releases.mjs /tmp/releases "$fake_port"

channel="$(post "${api}/channels" '{"name":"Made before updating"}' | jq -r .id)"

step "offering a good update"
publish 1.0.1
status="$(post "${api}/system/update/check" '{}')"
jq -e '.managed and .updatesEnabled and .latest.version == "1.0.1" and .latest.newer and (.latest.needsImage | not)' \
  <<<"$status" >/dev/null || fail "1.0.1 not offered: ${status}"

step "installing it"
post "${api}/system/update/install" '{"version":"1.0.1"}' >/dev/null
result="$(wait_result 1.0.1)"
echo "    ${result}"
jq -e '.ok' <<<"$result" >/dev/null || fail "the good update did not install"
wait_healthy 1.0.1
jq -e '.current == {"version":"1.0.1","source":"active"}' <<<"$(curl -fsS "${api}/system/update")" >/dev/null ||
  fail "1.0.1 is not the active version"
channel_exists "$channel" || fail "data made before the update is gone"
run_hello_stage "$channel"
curl -fsS "${base}/" | grep -q '<div id="root">' || fail "web app not served after the update"

step "installing a broken update"
publish 1.0.2
post "${api}/system/update/check" '{}' >/dev/null
post "${api}/system/update/install" '{"version":"1.0.2"}' >/dev/null
result="$(wait_result 1.0.2)"
echo "    ${result}"
jq -e '(.ok | not) and (.error | test("went back to 1.0.1"))' <<<"$result" >/dev/null ||
  fail "the broken update was not rolled back"
wait_healthy 1.0.1
channel_exists "$channel" || fail "data is gone after the rollback"
docker exec "$name" test ! -e /data/app/versions/1.0.2 || fail "the broken update was left installed"

step "update test passed"
