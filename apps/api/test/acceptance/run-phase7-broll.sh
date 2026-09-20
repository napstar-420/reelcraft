#!/usr/bin/env bash
# `acceptance:phase7-broll`'s real entry point (see package.json).
#
# `tsc -p tsconfig.acceptance.json`'s emitted `dist-acceptance/` isn't
# covered by the repo's eslint `ignores` (only `dist/`, the real build
# output, is) and there's no reason to add a whole new ignore pattern for a
# throwaway compile target this one script owns — cleaning it up on every
# exit (success or failure) via `trap` is simpler and keeps `pnpm lint` from
# ever seeing generated JS.
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf dist-acceptance
trap 'rm -rf dist-acceptance' EXIT

npx tsc -p tsconfig.acceptance.json
mkdir -p dist-acceptance
ln -sfn ../drizzle dist-acceptance/drizzle
node -r ./test/acceptance/preload-env.cjs dist-acceptance/test/acceptance/phase7-broll-frames.js
