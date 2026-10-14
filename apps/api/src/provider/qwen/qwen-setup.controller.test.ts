import { ConflictException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../settings/settings.service';
import { QwenTtsAdapter } from './qwen.adapter';
import { QwenTtsController } from './qwen.controller';
import { QwenTtsRuntime } from './qwen-runtime.service';
import { QwenSetupController } from './qwen-setup.controller';

const status = { mode: 'managed', phase: 'stopped' };

/**
 * Boots a real Nest app with the real controllers and adapter and a fake runtime, so it proves the
 * wiring (dependency injection by class), the routes and the request validation, which the unit tests
 * of each class cannot. The e2e suite needs Postgres and builds the whole app.
 */
async function boot(runtime: Record<string, unknown>) {
  const module = await Test.createTestingModule({
    controllers: [QwenSetupController, QwenTtsController],
    providers: [
      QwenTtsAdapter,
      { provide: QwenTtsRuntime, useValue: runtime },
      { provide: SettingsService, useValue: { qwenTtsUrl: async () => 'http://127.0.0.1:8091' } },
    ],
  }).compile();
  const app = module.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      ...(body !== undefined && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { app, call };
}

const apps: INestApplication[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const runtimeStub = (over: Record<string, unknown> = {}) => ({
  status: vi.fn(async () => status),
  install: vi.fn(async () => undefined),
  cancelInstall: vi.fn(),
  ensureRunning: vi.fn(async () => 'http://127.0.0.1:8091'),
  stop: vi.fn(async () => undefined),
  check: vi.fn(async () => status),
  use: vi.fn(),
  startsOnDemand: vi.fn(async () => false),
  readyModels: vi.fn(() => []),
  rememberReadyModels: vi.fn(),
  ...over,
});

describe('the Qwen3-TTS setup routes', () => {
  it('serve the status without starting anything', async () => {
    const runtime = runtimeStub();
    const { app, call } = await boot(runtime);
    apps.push(app);
    const response = await call('GET', '/qwen-tts/setup');
    expect(response).toEqual({ status: 200, body: status });
    expect(runtime.ensureRunning).not.toHaveBeenCalled();
    expect(runtime.install).not.toHaveBeenCalled();
  });

  it('install the engine for this computer unless told to use the CPU, and answer 202', async () => {
    const runtime = runtimeStub();
    const { app, call } = await boot(runtime);
    apps.push(app);
    expect((await call('POST', '/qwen-tts/setup/install', {})).status).toBe(202);
    expect(runtime.install).toHaveBeenLastCalledWith('auto');
    await call('POST', '/qwen-tts/setup/install', { backend: 'cpu' });
    expect(runtime.install).toHaveBeenLastCalledWith('cpu');
  });

  it('refuse a backend that is not auto or cpu', async () => {
    const runtime = runtimeStub();
    const { app, call } = await boot(runtime);
    apps.push(app);
    expect((await call('POST', '/qwen-tts/setup/install', { backend: 'cu130' })).status).toBe(400);
    expect(runtime.install).not.toHaveBeenCalled();
  });

  it('start, stop, cancel and check each answer with the status', async () => {
    const runtime = runtimeStub();
    const { app, call } = await boot(runtime);
    apps.push(app);
    for (const action of ['start', 'stop', 'cancel', 'check']) {
      expect(await call('POST', `/qwen-tts/setup/${action}`)).toEqual({
        status: 200,
        body: status,
      });
    }
    expect(runtime.ensureRunning).toHaveBeenCalledOnce();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(runtime.cancelInstall).toHaveBeenCalledOnce();
    expect(runtime.check).toHaveBeenCalledOnce();
  });

  it('turn a refusal from the runtime into its HTTP status', async () => {
    const runtime = runtimeStub({
      install: vi.fn().mockRejectedValue(new ConflictException('uv is not installed.')),
    });
    const { app, call } = await boot(runtime);
    apps.push(app);
    const response = await call('POST', '/qwen-tts/setup/install', {});
    expect(response.status).toBe(409);
    expect(response.body.message).toBe('uv is not installed.');
  });
});

describe('the Qwen3-TTS model routes', () => {
  it('validate the body, then use the adapter, which starts the service through the runtime', async () => {
    const runtime = runtimeStub({
      use: vi.fn(async (work: (base: string) => Promise<unknown>) => work('http://127.0.0.1:1')),
    });
    const { app, call } = await boot(runtime);
    apps.push(app);
    expect((await call('POST', '/qwen-tts/models/download', {})).status).toBe(400);
    expect((await call('POST', '/qwen-tts/models/link', { modelId: 'Qwen/a' })).status).toBe(400);
    expect(runtime.use).not.toHaveBeenCalled();

    // Port 1 refuses connections, which the adapter reports as a bad gateway.
    const unreachable = await call('POST', '/qwen-tts/models/download', { modelId: 'Qwen/a' });
    expect(unreachable.status).toBe(502);
    expect(runtime.use).toHaveBeenCalledOnce();
  });

  it('pass on a refusal from the runtime, such as "not set up yet"', async () => {
    const runtime = runtimeStub({
      use: vi.fn().mockRejectedValue(new ConflictException('Qwen3-TTS is not set up yet.')),
    });
    const { app, call } = await boot(runtime);
    apps.push(app);
    const response = await call('POST', '/qwen-tts/models/link', { modelId: 'Qwen/a', path: '/x' });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Qwen3-TTS is not set up yet.');
  });
});
