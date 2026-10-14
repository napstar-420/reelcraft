import { describe, expect, it } from 'vitest';
import {
  appendLog,
  fingerprint,
  installArgs,
  installEnv,
  lastLine,
  LOG_TAIL_BYTES,
  packageSize,
  portOf,
  serviceEnv,
  uvCandidates,
  venvArgs,
  venvPython,
} from './qwen-runtime';

describe('venvPython', () => {
  it('uses the layout of the OS: bin/python, or Scripts\\python.exe on Windows', () => {
    expect(venvPython('/home/me/qwen', 'linux')).toBe('/home/me/qwen/venv/bin/python');
    expect(venvPython('/Users/me/qwen', 'darwin')).toBe('/Users/me/qwen/venv/bin/python');
    expect(venvPython('C:\\Users\\me\\qwen', 'win32')).toBe(
      'C:\\Users\\me\\qwen\\venv\\Scripts\\python.exe',
    );
  });
});

describe('uvCandidates', () => {
  it('tries PATH first, then where the installer puts uv', () => {
    expect(uvCandidates('linux', '/home/me', {})).toEqual([
      'uv',
      '/home/me/.local/bin/uv',
      '/home/me/.cargo/bin/uv',
    ]);
  });

  it('looks for uv.exe under the Windows profile', () => {
    expect(uvCandidates('win32', 'C:\\Users\\me', { USERPROFILE: 'D:\\Profile' })).toEqual([
      'uv.exe',
      'D:\\Profile\\.local\\bin\\uv.exe',
      'D:\\Profile\\.cargo\\bin\\uv.exe',
    ]);
  });
});

describe('install commands', () => {
  it('creates a Python 3.12 environment', () => {
    expect(venvArgs('/h/venv')).toEqual(['venv', '/h/venv', '--python', '3.12']);
  });

  it('installs the engine for the chosen PyTorch build, pinned by constraints', () => {
    expect(
      installArgs({ python: '/h/venv/bin/python', sourceDir: '/src', backend: 'auto' }),
    ).toEqual([
      'pip',
      'install',
      '--python',
      '/h/venv/bin/python',
      '--torch-backend',
      'auto',
      '-r',
      '/src/pyproject.toml',
      '--extra',
      'engine',
      '-c',
      '/src/constraints.txt',
    ]);
    expect(installArgs({ python: 'p', sourceDir: '/s', backend: 'cpu' })).toContain('cpu');
  });
});

describe('what the child processes may see', () => {
  const base = {
    PATH: '/usr/bin',
    HOME: '/home/me',
    UV_CACHE_DIR: '/data/qwen-tts/cache',
    DATABASE_URL: 'postgres://user:secret@db/reelcraft',
    OPENROUTER_API_KEY: 'sk-secret',
    S3_SECRET_ACCESS_KEY: 'secret',
  };

  it('passes the service only what it needs, never the database password or provider keys', () => {
    const env = serviceEnv({ base, home: '/h', sourceDir: '/src', port: '8091' });
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/home/me',
      UV_CACHE_DIR: '/data/qwen-tts/cache',
      PYTHONPATH: '/src/src',
      QWEN_TTS_MODELS_DIR: '/h/models',
      QWEN_TTS_HOST: '127.0.0.1',
      QWEN_TTS_PORT: '8091',
      QWEN_TTS_EXIT_WITH_STDIN: '1',
      QWEN_TTS_ACCESS_LOG: '0',
    });
    expect(Object.keys(env).join(' ')).not.toMatch(/DATABASE|OPENROUTER|S3_/);
    expect(JSON.stringify(env)).not.toContain('secret');
  });

  it('gives uv the same allowlist, matching names without regard to case (Windows)', () => {
    const env = installEnv({ Path: 'C:\\bin', SystemRoot: 'C:\\Windows', DATABASE_URL: 'x' });
    expect(env).toMatchObject({ Path: 'C:\\bin', SystemRoot: 'C:\\Windows', NO_COLOR: '1' });
    expect(env).not.toHaveProperty('DATABASE_URL');
  });
});

describe('fingerprint', () => {
  it('changes with the pins and with the PyTorch build', () => {
    const a = fingerprint('torch==1', 'auto');
    expect(fingerprint('torch==1', 'auto')).toBe(a);
    expect(fingerprint('torch==2', 'auto')).not.toBe(a);
    expect(fingerprint('torch==1', 'cpu')).not.toBe(a);
  });
});

describe('packageSize', () => {
  it('is measured on a Mac and a guess elsewhere, and much larger with an NVIDIA GPU', () => {
    expect(packageSize('darwin', null)).toEqual({ bytes: 1.2e9, estimated: false });
    expect(packageSize('linux', null)).toEqual({ bytes: 1.2e9, estimated: true });
    expect(packageSize('win32', 'NVIDIA GeForce RTX 3060')).toEqual({
      bytes: 5e9,
      estimated: true,
    });
  });
});

describe('log tail', () => {
  it('drops colour codes, turns carriage returns into lines and keeps only the tail', () => {
    expect(appendLog('', '\u001b[32mok\u001b[0m\rnext')).toBe('ok\nnext');
    const long = appendLog('', 'x'.repeat(LOG_TAIL_BYTES + 500));
    expect(long).toHaveLength(LOG_TAIL_BYTES);
  });

  it('picks the last non-empty line as the error', () => {
    expect(lastLine('a\n\n  error: no matching wheel  \n\n')).toBe('error: no matching wheel');
    expect(lastLine('')).toBeNull();
  });
});

describe('portOf', () => {
  it('reads the port from an address, defaulting to 8091', () => {
    expect(portOf('http://127.0.0.1:9000')).toBe('9000');
    expect(portOf('http://127.0.0.1')).toBe('8091');
  });
});
