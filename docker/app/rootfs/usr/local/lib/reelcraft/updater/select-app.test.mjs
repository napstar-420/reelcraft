import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installedUsable, selectApp, toShellExports } from './select-app.mjs';
import { emptyState, updaterPaths } from './state.mjs';

const paths = updaterPaths('/data');
const image = { version: '0.2.0', runtime: 3, appDir: '/opt/reelcraft/app' };
const everything = () => true;

function select(state, exists = everything, img = image) {
  return selectApp({ image: img, state: { ...emptyState(), ...state }, paths, exists });
}

describe('selectApp', () => {
  it("runs the image's bundle when nothing is installed", () => {
    assert.deepEqual(select({}), {
      source: 'image',
      version: '0.2.0',
      runtime: 3,
      appDir: '/opt/reelcraft/app',
    });
  });

  it('runs an installed update that is newer than the image', () => {
    assert.deepEqual(select({ active: { version: '0.2.1', runtime: 3 } }), {
      source: 'active',
      version: '0.2.1',
      runtime: 3,
      appDir: '/data/app/versions/0.2.1',
    });
  });

  it('prefers an update on trial', () => {
    const state = {
      active: { version: '0.2.1', runtime: 3 },
      trial: { version: '0.2.2', runtime: 3, previous: { version: '0.2.1', runtime: 3 } },
    };
    assert.equal(select(state).version, '0.2.2');
    assert.equal(select(state).source, 'trial');
  });

  it('lets a newer or equal image replace an installed update', () => {
    assert.equal(select({ active: { version: '0.2.0', runtime: 3 } }).source, 'image');
    assert.equal(select({ active: { version: '0.1.9', runtime: 2 } }).source, 'image');
  });

  it('never runs an update that needs a newer runtime than the image', () => {
    assert.equal(select({ active: { version: '0.3.0', runtime: 4 } }).source, 'image');
  });

  it('falls back when the installed files are missing', () => {
    const state = {
      active: { version: '0.2.1', runtime: 3 },
      trial: { version: '0.2.2', runtime: 3 },
    };
    const onlyActive = (file) => file.startsWith('/data/app/versions/0.2.1/');
    assert.equal(select(state, onlyActive).version, '0.2.1');
    assert.equal(select(state, () => false).source, 'image');
  });

  it('does not update development builds', () => {
    const dev = { ...image, version: 'dev' };
    assert.equal(installedUsable({ version: '0.2.1', runtime: 3 }, dev), false);
    assert.equal(
      select({ active: { version: '9.9.9', runtime: 1 } }, everything, dev).source,
      'image',
    );
  });
});

describe('toShellExports', () => {
  it('quotes values for eval', () => {
    const out = toShellExports({ appDir: "/data/app/versions/it's", version: '1.0.0' });
    assert.equal(
      out,
      [
        "export REELCRAFT_APP_DIR='/data/app/versions/it'\\''s'",
        "export REELCRAFT_VERSION='1.0.0'",
        "export WEB_DIST_DIR='/data/app/versions/it'\\''s/apps/web/dist'",
      ].join('\n'),
    );
  });
});
