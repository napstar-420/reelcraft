import { describe, expect, it, vi } from 'vitest';
import type { EngineConfig } from '../config/engine-config';
import type { SettingsService } from '../settings/settings.service';
import { BlenderRuntime } from './blender-runtime.service';

const probeLine = (version: string) =>
  `REELCRAFT_PROBE ${JSON.stringify({ version, devices: [{ backend: 'CUDA', name: 'RTX' }] })}`;

function runtime(opts: {
  saved?: string;
  env?: string;
  existing?: string[];
  platform?: NodeJS.Platform;
  exec?: ReturnType<typeof vi.fn>;
}) {
  const settings = {
    get: vi.fn(async () => opts.saved),
    set: vi.fn(),
    delete: vi.fn(),
    onChange: vi.fn(),
  } as unknown as SettingsService;
  const config = {
    blenderPathFromEnv: opts.env,
    blenderHome: '/data/blender',
  } as unknown as EngineConfig;
  const exec = opts.exec ?? vi.fn(async () => ({ stdout: probeLine('5.2.2'), stderr: '' }));
  return {
    exec,
    runtime: new BlenderRuntime(config, settings, {
      exec,
      platform: opts.platform ?? 'linux',
      arch: 'x64',
      env: { PATH: '/usr/bin' },
      homedir: '/home/me',
      exists: async (file) => (opts.existing ?? []).includes(file),
    }),
  };
}

describe('BlenderRuntime.resolve', () => {
  it('prefers a saved path, then the environment, then the download, then an install', async () => {
    const download = '/data/blender/blender-5.2.2-linux-x64/blender';
    expect(await runtime({ saved: '/s/blender', env: '/e/blender' }).runtime.resolve()).toEqual({
      path: '/s/blender',
      source: 'saved',
    });
    expect(await runtime({ env: '/e/blender' }).runtime.resolve()).toEqual({
      path: '/e/blender',
      source: 'env',
    });
    expect(
      await runtime({ existing: [download, '/usr/bin/blender'] }).runtime.resolve(),
    ).toEqual({ path: download, source: 'managed' });
    expect(await runtime({ existing: ['/usr/bin/blender'] }).runtime.resolve()).toEqual({
      path: '/usr/bin/blender',
      source: 'found',
    });
    expect(await runtime({}).runtime.resolve()).toBeUndefined();
  });
});

describe('BlenderRuntime.binary', () => {
  it('says how to set Blender up when there is none', async () => {
    await expect(runtime({}).runtime.binary()).rejects.toThrow(/Settings, then Blender/);
  });

  it('refuses a saved path that is not Blender, rather than using another one', async () => {
    const exec = vi.fn(async () => ({ stdout: 'not blender', stderr: '' }));
    const { runtime: r } = runtime({ saved: '/s/python', existing: ['/usr/bin/blender'], exec });
    await expect(r.binary()).rejects.toThrow('/s/python is not Blender');
  });

  it('probes once and reuses what it found', async () => {
    const { runtime: r, exec } = runtime({ existing: ['/usr/bin/blender'] });
    expect(await r.binary()).toBe('/usr/bin/blender');
    expect(await r.binary()).toBe('/usr/bin/blender');
    expect(exec).toHaveBeenCalledTimes(1);
    const status = await r.status();
    expect(status.version).toBe('5.2.2');
    expect(status.devices).toEqual([{ backend: 'CUDA', name: 'RTX' }]);
    expect(status.download?.version).toBe('5.2.2');
  });
});
