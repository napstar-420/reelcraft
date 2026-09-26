import { describe, expect, it, vi } from 'vitest';
import type { InputDef } from '@reelcraft/shared';
import { buildLaunchInputs, executeRunLaunch, validateLaunchValues } from './run-launch.logic';

const inputs: InputDef[] = [
  { key: 'topic', label: 'Topic', required: true, accepts: { kind: 'text' } },
  {
    key: 'settings',
    label: 'Settings',
    required: true,
    accepts: { kind: 'data', schema: { type: 'object' } },
  },
  {
    key: 'cover',
    label: 'Cover',
    required: true,
    accepts: { kind: 'media.image', cardinality: 'one' },
  },
];

function file(name: string) {
  return new File(['bytes'], name, { type: 'image/png' });
}

describe('run launch input validation', () => {
  it('parses text/data values and keeps media out of CreateRunDto inputs', () => {
    expect(
      buildLaunchInputs(inputs, {
        topic: 'Space',
        settings: '{"duration": 60}',
        cover: [file('cover.png')],
      }),
    ).toEqual({ topic: 'Space', settings: { duration: 60 } });
  });

  it('reports required, malformed JSON, and single-cardinality violations', () => {
    const errors = validateLaunchValues(inputs, {
      topic: ' ',
      settings: '{',
      cover: [file('one.png'), file('two.png')],
    });
    expect(errors).toEqual({
      topic: 'Topic is required.',
      settings: 'Settings must contain valid JSON.',
      cover: 'Cover accepts exactly one file.',
    });
  });
});

describe('executeRunLaunch', () => {
  it('creates, uploads, attaches, starts, and returns the started run in order', async () => {
    const calls: string[] = [];
    const upload = vi.fn(async () => calls.push('upload'));
    const deps = {
      createRun: vi.fn(async () => {
        calls.push('create');
        return { id: 'run-1' };
      }),
      requestInputUpload: vi.fn(async () => {
        calls.push('presign');
        return { blobId: 'blob-1', objectKey: 'inputs/cover.png', uploadUrl: 'signed' };
      }),
      upload,
      hashFile: vi.fn(async () => 'sha'),
      attachRunInput: vi.fn(async () => calls.push('attach')),
      startRun: vi.fn(async () => {
        calls.push('start');
        return { id: 'run-1', state: 'RUNNING' };
      }),
    };

    const result = await executeRunLaunch(
      {
        channelId: 'channel-1',
        blueprintVersionId: 'version-1',
        budgetCapUsd: 5,
        inputDefs: inputs,
        values: {
          topic: 'Space',
          settings: '{"duration":60}',
          cover: [file('cover.png')],
        },
      },
      deps,
    );

    expect(calls).toEqual(['create', 'presign', 'upload', 'attach', 'start']);
    expect(deps.createRun).toHaveBeenCalledWith({
      channelId: 'channel-1',
      blueprintVersionId: 'version-1',
      budgetCapUsd: 5,
      inputs: { topic: 'Space', settings: { duration: 60 } },
      roleBindings: {},
    });
    expect(deps.attachRunInput).toHaveBeenCalledWith('run-1', 'cover', {
      blobs: [{ blobId: 'blob-1', objectKey: 'inputs/cover.png', sha256: 'sha' }],
    });
    expect(result).toEqual({ id: 'run-1', state: 'RUNNING' });
  });

  it('preserves the created run and resumes at start without creating or uploading again', async () => {
    const deps = {
      createRun: vi.fn(async () => ({ id: 'unexpected' })),
      requestInputUpload: vi.fn(),
      upload: vi.fn(),
      hashFile: vi.fn(),
      attachRunInput: vi.fn(),
      startRun: vi.fn(async () => ({ id: 'run-1', state: 'RUNNING' })),
    };

    await executeRunLaunch(
      {
        channelId: 'channel-1',
        blueprintVersionId: 'version-1',
        budgetCapUsd: 5,
        inputDefs: inputs,
        values: { topic: 'Space', settings: '{"duration":60}', cover: [file('cover.png')] },
        resume: { runId: 'run-1', phase: 'start' },
      },
      deps,
    );

    expect(deps.createRun).not.toHaveBeenCalled();
    expect(deps.requestInputUpload).not.toHaveBeenCalled();
    expect(deps.startRun).toHaveBeenCalledWith('run-1');
  });

  it('wraps upload failures with the recoverable run id and phase', async () => {
    const deps = {
      createRun: vi.fn(async () => ({ id: 'run-1' })),
      requestInputUpload: vi.fn(async () => {
        throw new Error('storage unavailable');
      }),
      upload: vi.fn(),
      hashFile: vi.fn(),
      attachRunInput: vi.fn(),
      startRun: vi.fn(),
    };

    await expect(
      executeRunLaunch(
        {
          channelId: 'channel-1',
          blueprintVersionId: 'version-1',
          budgetCapUsd: 5,
          inputDefs: [inputs[2]!],
          values: { cover: [file('cover.png')] },
        },
        deps,
      ),
    ).rejects.toMatchObject({ runId: 'run-1', phase: 'media' });
  });
  it('reconciles a lost start response when the run already left CREATED', async () => {
    const deps = {
      createRun: vi.fn(async () => ({ id: 'run-1' })),
      requestInputUpload: vi.fn(),
      upload: vi.fn(),
      hashFile: vi.fn(),
      attachRunInput: vi.fn(),
      startRun: vi.fn(async (): Promise<{ id: string; state: string }> => {
        throw new Error('network lost');
      }),
      getRun: vi.fn(async () => ({ id: 'run-1', state: 'RUNNING' })),
    };

    const result = await executeRunLaunch(
      {
        channelId: 'channel-1',
        blueprintVersionId: 'version-1',
        budgetCapUsd: 5,
        inputDefs: [],
        values: {},
      },
      deps,
    );

    expect(result).toEqual({ id: 'run-1', state: 'RUNNING' });
    expect(deps.getRun).toHaveBeenCalledWith('run-1');
  });
  it('skips media reattachment when a retry finds the input already satisfied', async () => {
    const deps = {
      createRun: vi.fn(async () => ({ id: 'unexpected' })),
      requestInputUpload: vi.fn(),
      upload: vi.fn(),
      hashFile: vi.fn(),
      attachRunInput: vi.fn(),
      getRunInputStatus: vi.fn(async () => ({ satisfied: true })),
      startRun: vi.fn(async () => ({ id: 'run-1', state: 'RUNNING' })),
    };

    await executeRunLaunch(
      {
        channelId: 'channel-1',
        blueprintVersionId: 'version-1',
        budgetCapUsd: 5,
        inputDefs: [inputs[2]!],
        values: { cover: [file('cover.png')] },
        resume: { runId: 'run-1', phase: 'media' },
      },
      deps,
    );

    expect(deps.getRunInputStatus).toHaveBeenCalledWith('run-1', 'cover');
    expect(deps.requestInputUpload).not.toHaveBeenCalled();
    expect(deps.attachRunInput).not.toHaveBeenCalled();
    expect(deps.startRun).toHaveBeenCalledWith('run-1');
  });
});
