import { describe, expect, it } from 'vitest';
import { LinkQwenModelDto, QwenTtsInstallDto, QwenTtsSetupDto } from './qwen-tts-setup.dto';

describe('QwenTtsInstallDto', () => {
  it('installs the build for this computer unless told to use the CPU', () => {
    expect(QwenTtsInstallDto.parse({})).toEqual({ backend: 'auto' });
    expect(QwenTtsInstallDto.parse({ backend: 'cpu' })).toEqual({ backend: 'cpu' });
  });

  it('rejects any other backend', () => {
    expect(QwenTtsInstallDto.safeParse({ backend: 'cu130' }).success).toBe(false);
  });
});

describe('LinkQwenModelDto', () => {
  it('trims the path and needs both fields', () => {
    expect(LinkQwenModelDto.parse({ modelId: 'Qwen/x', path: '  /models/qwen  ' }).path).toBe(
      '/models/qwen',
    );
    expect(LinkQwenModelDto.safeParse({ modelId: 'Qwen/x', path: '   ' }).success).toBe(false);
    expect(LinkQwenModelDto.safeParse({ path: '/models' }).success).toBe(false);
  });
});

describe('QwenTtsSetupDto', () => {
  const setup = {
    mode: 'managed',
    phase: 'running',
    error: null,
    owned: true,
    device: 'mps',
    deviceLabel: 'Apple GPU (MPS)',
    deviceReason: null,
    uv: { path: '/opt/homebrew/bin/uv', version: '0.12.23' },
    nvidiaGpu: null,
    inContainer: false,
    homeDir: '/Users/me/.reelcraft/qwen-tts',
    sizes: { packagesBytes: 1.2e9, packagesEstimated: false, freeBytes: 5e10 },
    log: '',
    startedAt: '2026-10-14T10:00:00.000Z',
  };

  it('accepts a status and rejects an unknown phase', () => {
    expect(QwenTtsSetupDto.safeParse(setup).success).toBe(true);
    expect(QwenTtsSetupDto.safeParse({ ...setup, phase: 'sleeping' }).success).toBe(false);
  });
});
