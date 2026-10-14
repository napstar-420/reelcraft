import { describe, expect, it } from 'vitest';
import type { QwenTtsSetupDto } from '@reelcraft/shared';
import {
  browserOs,
  describeSetup,
  deviceLine,
  DOCKER_GPU_COMMAND,
  gpuHints,
  hasRoomForInstall,
  packageSizeText,
  setupPollMs,
  uvInstallCommand,
} from './qwen-setup.logic';

const dto = (over: Partial<QwenTtsSetupDto> = {}): QwenTtsSetupDto => ({
  mode: 'managed',
  phase: 'not-installed',
  error: null,
  owned: false,
  device: null,
  deviceLabel: null,
  deviceReason: null,
  uv: { path: 'uv', version: '0.12.23' },
  nvidiaGpu: null,
  inContainer: false,
  homeDir: '/Users/me/.reelcraft/qwen-tts',
  sizes: { packagesBytes: 1.2e9, packagesEstimated: false, freeBytes: 50e9 },
  log: '',
  startedAt: null,
  ...over,
});

describe('browserOs', () => {
  it('reads the computer the browser is on, from the newest field that has it', () => {
    expect(browserOs({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac');
    expect(browserOs({ platform: 'MacIntel' })).toBe('mac');
    expect(browserOs({ platform: 'Win32' })).toBe('windows');
    expect(browserOs({ platform: 'Linux x86_64' })).toBe('linux');
    expect(browserOs({ userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64)' })).toBe('linux');
    expect(browserOs({})).toBe('other');
  });
});

describe('commands to copy', () => {
  it('installs uv with the documented command for each OS', () => {
    expect(uvInstallCommand('mac')).toBe('curl -LsSf https://astral.sh/uv/install.sh | sh');
    expect(uvInstallCommand('linux')).toBe(uvInstallCommand('mac'));
    expect(uvInstallCommand('windows')).toContain('install.ps1');
  });

  it('starts Reelcraft with the NVIDIA GPU passed in, on one line', () => {
    expect(DOCKER_GPU_COMMAND).toContain('--gpus all');
    expect(DOCKER_GPU_COMMAND).toContain('-v reelcraft-data:/data');
    expect(DOCKER_GPU_COMMAND).not.toContain('\n');
  });
});

describe('sizes the confirm dialog shows', () => {
  it('says "about" and flags an estimate', () => {
    expect(packageSizeText(dto())).toBe('about 1.2 GB');
    expect(
      packageSizeText(
        dto({ sizes: { packagesBytes: 5e9, packagesEstimated: true, freeBytes: null } }),
      ),
    ).toBe('about 5.0 GB (an estimate)');
  });

  it('wants the size plus 1 GB free, and trusts an unknown amount', () => {
    const sizes = (freeBytes: number | null) => ({
      packagesBytes: 1.2e9,
      packagesEstimated: false,
      freeBytes,
    });
    expect(hasRoomForInstall(dto({ sizes: sizes(2.1e9) }))).toBe(false);
    expect(hasRoomForInstall(dto({ sizes: sizes(2.3e9) }))).toBe(true);
    expect(hasRoomForInstall(dto({ sizes: sizes(null) }))).toBe(true);
  });
});

describe('deviceLine', () => {
  it('names the device, explains a CPU, and says when it is still looking', () => {
    expect(deviceLine(dto({ device: 'mps', deviceLabel: 'Apple GPU (MPS)' }))).toBe(
      'Running on: Apple GPU (MPS)',
    );
    expect(
      deviceLine(
        dto({ device: 'cpu', deviceLabel: 'CPU', deviceReason: 'No compatible GPU found' }),
      ),
    ).toBe('Running on: CPU (No compatible GPU found)');
    expect(deviceLine(dto())).toBe('Checking which GPU it can use…');
  });
});

describe('describeSetup', () => {
  const os = 'mac' as const;

  it('offers the one-time setup, with both sizes up front, when nothing is installed', () => {
    const view = describeSetup(dto(), os);
    expect(view.actions).toEqual(['install']);
    expect(view.detail).toContain('about 1.2 GB');
    expect(view.detail).toContain('2.5 GB or 4.5 GB');
    expect(view.detail).toContain('only when you choose one');
  });

  it('asks for uv with the command for the OS and a way to check again', () => {
    const view = describeSetup(dto({ phase: 'needs-uv' }), 'windows');
    expect(view.actions).toEqual(['check']);
    expect(view.uvCommand).toContain('install.ps1');
    expect(describeSetup(dto({ phase: 'needs-uv' }), 'linux').uvCommand).toContain('install.sh');
  });

  it('shows progress with the log and a way to cancel while installing', () => {
    const view = describeSetup(dto({ phase: 'installing' }), os);
    expect(view).toMatchObject({ busy: true, showLog: true, actions: ['cancel'] });
  });

  it('after a failed install, offers a retry and the CPU build', () => {
    const view = describeSetup(dto({ phase: 'install-failed', error: 'no wheel for torch' }), os);
    expect(view).toMatchObject({ tone: 'error', detail: 'no wheel for torch', showLog: true });
    expect(view.actions).toEqual(['install', 'install-cpu']);
  });

  it('says it starts when used and stops when idle, once installed', () => {
    const view = describeSetup(dto({ phase: 'stopped' }), os);
    expect(view.actions).toEqual(['start', 'reinstall']);
    expect(view.detail).toContain('starts when you use it');
  });

  it('reports the device when running, and lets Reelcraft stop only what it started', () => {
    const running = dto({
      phase: 'running',
      owned: true,
      device: 'mps',
      deviceLabel: 'Apple GPU (MPS)',
    });
    expect(describeSetup(running, os)).toMatchObject({
      headline: 'Running on: Apple GPU (MPS)',
      actions: ['stop', 'reinstall'],
    });
    const adopted = describeSetup({ ...running, owned: false }, os);
    expect(adopted.actions).toEqual([]);
    expect(adopted.detail).toContain('Started outside Reelcraft');
  });

  it('offers to start or reinstall after a crash, with the log', () => {
    const view = describeSetup(dto({ phase: 'failed', error: 'Segmentation fault' }), os);
    expect(view).toMatchObject({ tone: 'error', showLog: true, actions: ['start', 'reinstall'] });
  });

  it('for a service the user runs, offers nothing and says whether it can be reached', () => {
    const up = describeSetup(dto({ mode: 'external', phase: 'running' }), os);
    expect(up).toMatchObject({ headline: 'Using the service you run yourself', actions: [] });
    const down = describeSetup(
      dto({ mode: 'external', phase: 'stopped', error: "Can't reach the service at http://x." }),
      os,
    );
    expect(down).toMatchObject({ tone: 'warn', detail: "Can't reach the service at http://x." });
  });

  it('says plainly when there is nothing to set up in this copy of Reelcraft', () => {
    const view = describeSetup(dto({ phase: 'unavailable', error: 'No service here.' }), os);
    expect(view).toMatchObject({ headline: "Set up isn't available here", actions: [] });
  });
});

describe('gpuHints', () => {
  it('says nothing outside Docker', () => {
    expect(gpuHints(dto({ inContainer: false }), 'windows')).toEqual([]);
  });

  it("tells Mac users in Docker the Mac's GPU can't be used, and what to do instead", () => {
    const [hint] = gpuHints(dto({ inContainer: true }), 'mac');
    expect(hint).toContain("can't use your Mac's GPU");
    expect(hint).toContain('Use a service you run yourself');
  });

  it('tells Windows and Linux users in Docker how to pass an NVIDIA GPU in, unless one is visible', () => {
    expect(gpuHints(dto({ inContainer: true }), 'windows')[0]).toContain('--gpus all');
    expect(gpuHints(dto({ inContainer: true }), 'linux')[0]).toContain('NVIDIA Container Toolkit');
    expect(gpuHints(dto({ inContainer: true, nvidiaGpu: 'NVIDIA RTX 3060' }), 'linux')).toEqual([]);
  });

  it('puts the guidance on the setup view, where people will see it', () => {
    const view = describeSetup(dto({ phase: 'not-installed', inContainer: true }), 'windows');
    expect(view.hints).toHaveLength(1);
  });
});

describe('setupPollMs', () => {
  it('asks quickly while something changes, and slowly otherwise', () => {
    expect(setupPollMs(undefined)).toBe(3000);
    for (const phase of ['installing', 'starting', 'stopping'] as const) {
      expect(setupPollMs(dto({ phase }))).toBe(1000);
    }
    expect(setupPollMs(dto({ phase: 'running' }))).toBe(2000); // device not known yet
    expect(setupPollMs(dto({ phase: 'running', deviceLabel: 'CPU' }))).toBe(15000);
    expect(setupPollMs(dto({ phase: 'stopped' }))).toBe(15000);
  });
});
