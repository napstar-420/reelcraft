import type { AttachInputDto, CreateRunDto, InputDef } from '@reelcraft/shared';

export type LaunchValue = string | File[];
export type LaunchValues = Record<string, LaunchValue | undefined>;
export type LaunchResume = {
  runId: string;
  phase: 'media' | 'start';
  completedMediaKeys?: string[];
};

export class LaunchRunError extends Error {
  constructor(
    message: string,
    readonly runId: string,
    readonly phase: LaunchResume['phase'],
    readonly completedMediaKeys: string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LaunchRunError';
  }
}

export function validateLaunchValues(
  inputDefs: InputDef[],
  values: LaunchValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const def of inputDefs) {
    const value = values[def.key];
    if (def.accepts.kind === 'text') {
      if (def.required && (typeof value !== 'string' || value.trim().length === 0)) {
        errors[def.key] = `${def.label} is required.`;
      }
      continue;
    }
    if (def.accepts.kind === 'data') {
      if (def.required && (typeof value !== 'string' || value.trim().length === 0)) {
        errors[def.key] = `${def.label} is required.`;
      } else if (typeof value === 'string' && value.trim()) {
        try {
          JSON.parse(value);
        } catch {
          errors[def.key] = `${def.label} must contain valid JSON.`;
        }
      }
      continue;
    }
    const files = Array.isArray(value) ? value : [];
    if (def.accepts.cardinality === 'one' && files.length > 1) {
      errors[def.key] = `${def.label} accepts exactly one file.`;
    } else if (def.required && files.length === 0) {
      errors[def.key] = `${def.label} is required.`;
    }
  }
  return errors;
}

export function buildLaunchInputs(inputDefs: InputDef[], values: LaunchValues) {
  const inputs: Record<string, unknown> = {};
  for (const def of inputDefs) {
    const value = values[def.key];
    if (def.accepts.kind === 'text' && typeof value === 'string' && value.trim()) {
      inputs[def.key] = value;
    }
    if (def.accepts.kind === 'data' && typeof value === 'string' && value.trim()) {
      inputs[def.key] = JSON.parse(value);
    }
  }
  return inputs;
}

export type RunLaunchRequest = {
  channelId: string;
  blueprintVersionId: string;
  budgetCapUsd: number;
  inputDefs: InputDef[];
  values: LaunchValues;
  resume?: LaunchResume;
};

type CreatedRun = { id: string };
type StartedRun = { id: string } & Record<string, unknown>;

type RunLaunchDependencies<TStarted extends StartedRun> = {
  createRun: (dto: CreateRunDto) => Promise<CreatedRun>;
  requestInputUpload: (
    runId: string,
    inputKey: string,
    ext: string,
  ) => Promise<{ blobId: string; objectKey: string; uploadUrl: string }>;
  upload: (url: string, file: File) => Promise<unknown>;
  hashFile: (file: File) => Promise<string>;
  attachRunInput: (runId: string, inputKey: string, dto: AttachInputDto) => Promise<unknown>;
  getRunInputStatus?: (runId: string, inputKey: string) => Promise<{ satisfied: boolean }>;
  startRun: (runId: string) => Promise<TStarted>;
  getRun?: (runId: string) => Promise<TStarted & { state?: string }>;
};

function extension(file: File) {
  const index = file.name.lastIndexOf('.');
  return index >= 0 ? file.name.slice(index + 1) : '';
}

export async function executeRunLaunch<TStarted extends StartedRun>(
  request: RunLaunchRequest,
  deps: RunLaunchDependencies<TStarted>,
): Promise<TStarted> {
  const errors = validateLaunchValues(request.inputDefs, request.values);
  if (Object.keys(errors).length > 0) throw new Error('Run inputs are invalid.');

  const runId =
    request.resume?.runId ??
    (
      await deps.createRun({
        channelId: request.channelId,
        blueprintVersionId: request.blueprintVersionId,
        budgetCapUsd: request.budgetCapUsd,
        inputs: buildLaunchInputs(request.inputDefs, request.values),
        roleBindings: {},
      })
    ).id;

  if (request.resume?.phase !== 'start') {
    const completedMediaKeys = [...(request.resume?.completedMediaKeys ?? [])];
    try {
      for (const def of request.inputDefs) {
        if (def.accepts.kind === 'text' || def.accepts.kind === 'data') continue;
        if (completedMediaKeys.includes(def.key)) continue;
        if (request.resume && deps.getRunInputStatus) {
          const status = await deps.getRunInputStatus(runId, def.key);
          if (status.satisfied) {
            completedMediaKeys.push(def.key);
            continue;
          }
        }
        const files = request.values[def.key];
        if (!Array.isArray(files) || files.length === 0) continue;
        const blobs = [];
        for (const file of files) {
          const [descriptor, sha256] = await Promise.all([
            deps.requestInputUpload(runId, def.key, extension(file)),
            deps.hashFile(file),
          ]);
          await deps.upload(descriptor.uploadUrl, file);
          blobs.push({
            blobId: descriptor.blobId,
            objectKey: descriptor.objectKey,
            sha256,
          });
        }
        await deps.attachRunInput(runId, def.key, { blobs });
        completedMediaKeys.push(def.key);
      }
    } catch (cause) {
      throw new LaunchRunError(
        cause instanceof Error ? cause.message : 'Media upload failed.',
        runId,
        'media',
        completedMediaKeys,
        { cause },
      );
    }
  }

  try {
    return await deps.startRun(runId);
  } catch (cause) {
    if (deps.getRun) {
      try {
        const current = await deps.getRun(runId);
        if (current.state !== 'CREATED') return current;
      } catch {
        // Preserve the original start failure when reconciliation also fails.
      }
    }
    throw new LaunchRunError(
      cause instanceof Error ? cause.message : 'Run start failed.',
      runId,
      'start',
      [],
      { cause },
    );
  }
}
