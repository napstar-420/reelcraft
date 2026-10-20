import { describe, expect, it } from 'vitest';
import {
  blenderBuild,
  blenderEnv,
  managedBinary,
  nativeCandidates,
  onPath,
  parseProbe,
} from './blender-runtime';

describe('blenderBuild', () => {
  it('has a download for Linux x64 and Windows, not for macOS or Linux arm64', () => {
    expect(blenderBuild('linux', 'x64')?.file).toMatch(/linux-x64\.tar\.xz$/);
    expect(blenderBuild('win32', 'x64')?.file).toMatch(/windows-x64\.zip$/);
    expect(blenderBuild('win32', 'arm64')?.file).toMatch(/windows-arm64\.zip$/);
    expect(blenderBuild('darwin', 'arm64')).toBeUndefined();
    expect(blenderBuild('linux', 'arm64')).toBeUndefined();
  });

  it('finds the executable inside the unpacked folder', () => {
    const linux = blenderBuild('linux', 'x64')!;
    expect(managedBinary('/data/blender', linux, 'linux')).toBe(
      '/data/blender/blender-5.2.2-linux-x64/blender',
    );
    const win = blenderBuild('win32', 'x64')!;
    expect(managedBinary('C:\\rc', win, 'win32')).toBe(
      'C:\\rc\\blender-5.2.2-windows-x64\\blender.exe',
    );
  });
});

describe('nativeCandidates', () => {
  it('tries the macOS app before PATH', () => {
    expect(nativeCandidates('darwin', '/Users/me')).toEqual([
      '/Applications/Blender.app/Contents/MacOS/Blender',
      '/Users/me/Applications/Blender.app/Contents/MacOS/Blender',
      'blender',
    ]);
  });

  it('looks in each versioned Program Files folder on Windows, newest first', () => {
    const found = nativeCandidates('win32', 'C:\\Users\\me', { ProgramFiles: 'D:\\Apps' });
    expect(found[0]).toBe('D:\\Apps\\Blender Foundation\\Blender 5.2\\blender.exe');
    expect(found.at(-1)).toBe('blender.exe');
  });

  it('expands a bare name over PATH', () => {
    expect(onPath('blender', 'linux', { PATH: '/usr/bin:/opt/b' })).toEqual([
      '/usr/bin/blender',
      '/opt/b/blender',
    ]);
  });
});

describe('parseProbe', () => {
  it('reads the version and GPUs from the probe line among Blender output', () => {
    const stdout = [
      'Blender 5.2.2 LTS',
      'REELCRAFT_PROBE {"version":"5.2.2 LTS","devices":[{"backend":"METAL","name":"Apple M1 Pro (GPU - 16 cores)"},{"backend":"CPU","name":"x"}]}',
      'Blender quit',
    ].join('\n');
    expect(parseProbe(stdout)).toEqual({
      version: '5.2.2 LTS',
      devices: [{ backend: 'METAL', name: 'Apple M1 Pro (GPU - 16 cores)' }],
    });
  });

  it('keeps the version when listing GPUs failed', () => {
    expect(
      parseProbe('REELCRAFT_PROBE {"version":"5.2","devices":[],"error":"no driver"}'),
    ).toEqual({
      version: '5.2',
      devices: [],
      error: 'no driver',
    });
  });

  it('is undefined for anything that is not the probe', () => {
    expect(parseProbe('hello')).toBeUndefined();
    expect(parseProbe('REELCRAFT_PROBE {not json')).toBeUndefined();
  });
});

describe('blenderEnv', () => {
  it('passes GPU selection through but never secrets', () => {
    const env = blenderEnv({
      PATH: '/bin',
      NVIDIA_VISIBLE_DEVICES: 'all',
      CUDA_VISIBLE_DEVICES: '0',
      DATABASE_URL: 'postgres://secret',
      OPENROUTER_API_KEY: 'sk-secret',
    });
    expect(env).toEqual({
      PATH: '/bin',
      NVIDIA_VISIBLE_DEVICES: 'all',
      CUDA_VISIBLE_DEVICES: '0',
      PYTHONDONTWRITEBYTECODE: '1',
    });
  });
});
