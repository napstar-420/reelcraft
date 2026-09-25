import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { InputDef, RoleDef, StageDef } from '@reelcraft/shared';
import type { CapabilityImpl } from '../capability/capability.interface';
import type { CapabilityRegistry } from '../capability/capability.registry';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { ScriptSandboxService } from '../sandbox/script-sandbox.service';
import type { Env } from '../config/env.schema';
import { EngineConfig } from '../config/engine-config';
import { HELLO_STAGE_GRAPH } from '../template/template-seed.service';
import { BlueprintValidatorService } from './blueprint-validator.service';

function fakeEngineConfig(): EngineConfig {
  const env: Env = {
    NODE_ENV: 'test',
    API_PORT: 3000,
    DATABASE_URL: 'postgres://x',
    S3_ENDPOINT: 'http://x',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'x',
    S3_ACCESS_KEY_ID: 'x',
    S3_SECRET_ACCESS_KEY: 'x',
    S3_FORCE_PATH_STYLE: true,
    PRESIGN_TTL_SEC: 900,
    INNGEST_BASE_URL: 'http://x',
    INNGEST_EVENT_KEY: 'x',
    INNGEST_SIGNING_KEY: 'x',
    WORKSPACE_ROOT: './.workspace',
    COMPUTE_MIN_FREE_BYTES: 0,
    COMPUTE_JOB_RETENTION_SEC: 86_400,
    BLOB_RETENTION_DAYS: 30,
    ITERATE_MAX_ITEMS: 50,
    PRE_SUBMIT_TTL_SEC: 600,
    FETCH_ALLOWANCE_SEC: 120,
    QC_ERROR_RETRIES: 2,
    INFRA_RETRIES: 2,
    SANDBOX_MEMORY_MB: 32,
    SANDBOX_TIMEOUT_MS: 100,
    PREVIEW_TOKEN_TTL_SEC: 600,
  };
  return new EngineConfig(new ConfigService<Env, true>(env));
}

const sandbox = new ScriptSandboxService(fakeEngineConfig());

function stage(overrides: Partial<StageDef> & Pick<StageDef, 'key'>): StageDef {
  return {
    label: overrides.key,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    ...overrides,
  };
}

const llmGenerate: CapabilityImpl = {
  modality: 'text',
  kind: 'sync',
  label: 'Generate Text',
  description: 'Generate text with an LLM from a prompt.',
  configSchema: { type: 'object' },
  slots: () => [],
  allowedOutputs: () => ['text', 'data'],
  estimateCost: async () => {
    throw new Error('unused in tests');
  },
  submit: async () => {
    throw new Error('unused in tests');
  },
  poll: async () => {
    throw new Error('unused in tests');
  },
  fetch: async () => {
    throw new Error('unused in tests');
  },
};

const withRequiredSlot: CapabilityImpl = {
  ...llmGenerate,
  slots: () => [{ name: 'topic', accepts: ['text'], required: true, cardinality: 'one' }],
};

const withOptionalSlot: CapabilityImpl = {
  ...llmGenerate,
  slots: () => [{ name: 'topic', accepts: ['text'], required: false, cardinality: 'one' }],
};

const withManySlot: CapabilityImpl = {
  ...llmGenerate,
  slots: () => [{ name: 'items', accepts: ['text'], required: false, cardinality: 'many' }],
};

const withManyImageReferences: CapabilityImpl = {
  ...llmGenerate,
  slots: () => [
    { name: 'references', accepts: ['media.image'], required: false, cardinality: 'many' },
  ],
};

const withOneImageSlot: CapabilityImpl = {
  ...llmGenerate,
  slots: () => [
    { name: 'startFrame', accepts: ['media.image'], required: false, cardinality: 'one' },
  ],
};

const videoGen: CapabilityImpl = {
  ...llmGenerate,
  modality: 'video',
  allowedOutputs: () => ['media.video'],
};

function fakeRegistry(capabilities: Record<string, CapabilityImpl>): CapabilityRegistry {
  return {
    get: (key: string) => {
      const impl = capabilities[key];
      if (!impl) throw new Error(`unknown capability "${key}"`);
      return impl;
    },
  } as unknown as CapabilityRegistry;
}

function makeValidator(
  capabilities: Record<string, CapabilityImpl> = { 'text.generate': llmGenerate },
) {
  return new BlueprintValidatorService(
    fakeRegistry(capabilities),
    new SchemaValidatorService(),
    sandbox,
  );
}

function hasError(
  issues: ReturnType<BlueprintValidatorService['validate']>,
  path?: string,
): boolean {
  return issues.some((i) => i.severity === 'error' && (!path || i.path.startsWith(path)));
}
function hasWarning(
  issues: ReturnType<BlueprintValidatorService['validate']>,
  path?: string,
): boolean {
  return issues.some((i) => i.severity === 'warning' && (!path || i.path.startsWith(path)));
}

describe('BlueprintValidatorService', () => {
  beforeAll(async () => {
    await sandbox.ready();
  });

  it('the seeded "Hello Stage" template validates with zero errors', () => {
    const validator = makeValidator();
    const issues = validator.validate({ graph: HELLO_STAGE_GRAPH, inputs: [], roles: [] });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('errors on an empty graph', () => {
    const validator = makeValidator();
    expect(hasError(validator.validate({ graph: [], inputs: [], roles: [] }))).toBe(true);
  });

  it('errors on {from: "prev"} on the first stage', () => {
    const validator = makeValidator();
    const graph = [stage({ key: 'a', context: { x: { from: 'prev' } } })];
    expect(hasError(validator.validate({ graph, inputs: [], roles: [] }))).toBe(true);
  });

  it('errors on duplicate stage keys', () => {
    const validator = makeValidator();
    const graph = [stage({ key: 'a' }), stage({ key: 'a' })];
    expect(hasError(validator.validate({ graph, inputs: [], roles: [] }))).toBe(true);
  });

  it('errors on more than one declared role', () => {
    const validator = makeValidator();
    const roles: RoleDef[] = [
      { key: 'host', label: 'Host', required: false },
      { key: 'guest', label: 'Guest', required: false },
    ];
    const issues = validator.validate({ graph: [stage({ key: 'a' })], inputs: [], roles });
    expect(hasError(issues, 'roles')).toBe(true);
  });

  it('allows a Character role only in a many-image reference slot', () => {
    const validator = makeValidator({ 'text.generate': withManyImageReferences });
    const roles: RoleDef[] = [
      {
        key: 'host',
        label: 'Host',
        required: true,
        characterId: 'char-1',
        referenceBlobIds: ['ref-1'],
      },
    ];
    const issues = validator.validate({
      graph: [stage({ key: 'a', slots: { references: { from: 'role', roleKey: 'host' } } })],
      inputs: [],
      roles,
      blueprintChannelId: 'channel-1',
      charactersById: new Map([
        [
          'char-1',
          { channelId: 'channel-1', readiness: 'ready', referenceBlobIds: new Set(['ref-1']) },
        ],
      ]),
    });
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('rejects a Character role in a single-image slot before a run can spend', () => {
    const validator = makeValidator({ 'text.generate': withOneImageSlot });
    const roles: RoleDef[] = [
      {
        key: 'host',
        label: 'Host',
        required: true,
        characterId: 'char-1',
        referenceBlobIds: ['ref-1'],
      },
    ];
    const issues = validator.validate({
      graph: [stage({ key: 'a', slots: { startFrame: { from: 'role', roleKey: 'host' } } })],
      inputs: [],
      roles,
      blueprintChannelId: 'channel-1',
      charactersById: new Map([
        [
          'char-1',
          { channelId: 'channel-1', readiness: 'ready', referenceBlobIds: new Set(['ref-1']) },
        ],
      ]),
    });
    expect(hasError(issues, 'stages.a.slots.startFrame')).toBe(true);
  });

  it('errors on an unknown capability', () => {
    const validator = makeValidator();
    const graph = [stage({ key: 'a', capability: 'nonexistent.capability' })];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.capability'),
    ).toBe(true);
  });

  it('errors when output.kind is not in allowedOutputs', () => {
    const validator = makeValidator();
    const graph = [stage({ key: 'a', output: { kind: 'file.subtitles' } })];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.output.kind'),
    ).toBe(true);
  });

  it('errors when StageDef.config fails the capability configSchema', () => {
    const capability: CapabilityImpl = {
      ...llmGenerate,
      configSchema: {
        type: 'object',
        properties: { mode: { type: 'string' } },
        required: ['mode'],
      },
    };
    const validator = makeValidator({ 'text.generate': capability });
    const graph = [stage({ key: 'a', config: {} })];
    expect(hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.config')).toBe(
      true,
    );
  });

  it('warns on a "data" output schema with no properties', () => {
    const validator = makeValidator();
    const graph = [stage({ key: 'a', output: { kind: 'data', schema: { type: 'object' } } })];
    const issues = validator.validate({ graph, inputs: [], roles: [] });
    expect(hasWarning(issues, 'stages.a.output.schema')).toBe(true);
  });

  it('errors on a malformed data output schema (dialect violation)', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'a',
        output: { kind: 'data', schema: { type: 'object', $ref: '#/x' } as never },
      }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.output.schema'),
    ).toBe(true);
  });

  it('warns when a stage declares neither checks nor qc', () => {
    const validator = makeValidator();
    const issues = validator.validate({ graph: [stage({ key: 'a' })], inputs: [], roles: [] });
    expect(hasWarning(issues, 'stages.a')).toBe(true);
  });

  it('errors when qc is declared on a media.video output', () => {
    const validator = makeValidator({
      'text.generate': { ...llmGenerate, allowedOutputs: () => ['media.video'] },
    });
    const graph = [
      stage({
        key: 'a',
        output: { kind: 'media.video' },
        qc: {
          criteria: 'x',
          threshold: 50,
          model: { provider: 'fake', modelId: 'fake-judge-1', params: {} },
          includeInputs: false,
        },
      }),
    ];
    expect(hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.qc')).toBe(
      true,
    );
  });

  it('errors when qc is declared on a human.input stage', () => {
    const validator = makeValidator({
      'human.input': {
        ...llmGenerate,
        modality: 'human',
        configSchema: { type: 'object' },
        slots: () => [],
        allowedOutputs: () => ['text', 'data'],
      },
    });
    const graph = [
      stage({
        key: 'choose_theme',
        capability: 'human.input',
        qc: {
          criteria: 'x',
          threshold: 50,
          model: { provider: 'fake', modelId: 'fake-judge-1', params: {} },
          includeInputs: false,
        },
      }),
    ];

    const issues = validator.validate({ graph, inputs: [], roles: [] });

    expect(
      issues.some(
        (issue) =>
          issue.severity === 'error' &&
          issue.path === 'stages.choose_theme.qc' &&
          issue.message.includes('human.input'),
      ),
    ).toBe(true);
  });

  it('errors on a required slot left unbound', () => {
    const validator = makeValidator({ 'text.generate': withRequiredSlot });
    const graph = [stage({ key: 'a' })];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.slots.topic'),
    ).toBe(true);
  });

  it('errors when a bound slot is structurally incompatible', () => {
    const validator = makeValidator({ 'text.generate': withRequiredSlot });
    const graph = [
      stage({
        key: 'a',
        slots: { topic: { from: 'input', inputKey: 'img' } },
      }),
    ];
    const inputs: InputDef[] = [
      {
        key: 'img',
        label: 'Image',
        required: true,
        accepts: { kind: 'media.image', cardinality: 'one' },
      },
    ];
    expect(hasError(validator.validate({ graph, inputs, roles: [] }), 'stages.a.slots.topic')).toBe(
      true,
    );
  });

  it('passes a compatible slot binding', () => {
    const validator = makeValidator({ 'text.generate': withRequiredSlot });
    const graph = [stage({ key: 'a', slots: { topic: { from: 'input', inputKey: 'topic' } } })];
    const inputs: InputDef[] = [
      { key: 'topic', label: 'Topic', required: true, accepts: { kind: 'text' } },
    ];
    expect(hasError(validator.validate({ graph, inputs, roles: [] }), 'stages.a.slots.topic')).toBe(
      false,
    );
  });

  it('errors on {from: "input"} naming an undeclared input', () => {
    const validator = makeValidator();
    const graph = [stage({ key: 'a', context: { x: { from: 'input', inputKey: 'nope' } } })];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.context.x'),
    ).toBe(true);
  });

  it('errors on {from: "memory"} naming a key no earlier stage writes', () => {
    const validator = makeValidator();
    const graph = [stage({ key: 'a', context: { x: { from: 'memory', key: 'nope' } } })];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.context.x'),
    ).toBe(true);
  });

  it('resolves {from: "memory"} against an earlier stage\'s writes', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'a',
        output: {
          kind: 'data',
          schema: { type: 'object', properties: { title: { type: 'string' } } },
        },
        writes: { outline: '$' },
      }),
      stage({ key: 'b', context: { x: { from: 'memory', key: 'outline', path: 'title' } } }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.b.context.x'),
    ).toBe(false);
  });

  it('errors on {from: "role"} naming an undeclared role', () => {
    const validator = makeValidator();
    const graph = [stage({ key: 'a', context: { x: { from: 'role', roleKey: 'nope' } } })];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.context.x'),
    ).toBe(true);
  });

  it('errors on {from: "asset"} naming an unknown asset', () => {
    const validator = makeValidator();
    const issues = validator.validate({
      graph: [stage({ key: 'a', context: { x: { from: 'asset', assetId: 'x' } } })],
      inputs: [],
      roles: [],
    });
    expect(hasError(issues, 'stages.a.context.x')).toBe(true);
  });

  it('errors on {from: "asset"} naming an asset from a different channel', () => {
    const validator = makeValidator();
    const issues = validator.validate({
      graph: [stage({ key: 'a', context: { x: { from: 'asset', assetId: 'logo' } } })],
      inputs: [],
      roles: [],
      assetsById: new Map([['logo', { kind: 'media.image', channelId: 'other-channel' }]]),
      blueprintChannelId: 'this-channel',
    });
    expect(hasError(issues, 'stages.a.context.x')).toBe(true);
  });

  it('errors on {from: "asset"} naming a font/lut asset — not bindable via refs', () => {
    const validator = makeValidator();
    const issues = validator.validate({
      graph: [stage({ key: 'a', context: { x: { from: 'asset', assetId: 'brand-font' } } })],
      inputs: [],
      roles: [],
      assetsById: new Map([['brand-font', { kind: 'font', channelId: 'ch1' }]]),
      blueprintChannelId: 'ch1',
    });
    expect(hasError(issues, 'stages.a.context.x')).toBe(true);
  });

  it('resolves {from: "asset"} against a same-channel media asset', () => {
    const validator = makeValidator();
    const issues = validator.validate({
      graph: [stage({ key: 'a', context: { x: { from: 'asset', assetId: 'logo' } } })],
      inputs: [],
      roles: [],
      assetsById: new Map([['logo', { kind: 'media.image', channelId: 'ch1' }]]),
      blueprintChannelId: 'ch1',
    });
    expect(hasError(issues, 'stages.a.context.x')).toBe(false);
  });

  it('errors on {from:"item"}/{from:"prevItem"} used on a non-iterating stage', () => {
    const validator = makeValidator();
    const itemIssues = validator.validate({
      graph: [stage({ key: 'a', context: { x: { from: 'item' } } })],
      inputs: [],
      roles: [],
    });
    expect(hasError(itemIssues, 'stages.a.context.x')).toBe(true);

    const prevItemIssues = validator.validate({
      graph: [stage({ key: 'a', context: { x: { from: 'prevItem' } } })],
      inputs: [],
      roles: [],
    });
    expect(hasError(prevItemIssues, 'stages.a.context.x')).toBe(true);
  });

  it('validates a template path against the bound context schema', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'a',
        output: {
          kind: 'data',
          schema: { type: 'object', properties: { title: { type: 'string' } } },
        },
        writes: { outline: '$' },
      }),
      stage({
        key: 'b',
        context: { outline: { from: 'prev' } },
        instructions: { template: 'Title: {{ outline.title }}' },
      }),
      stage({
        key: 'c',
        context: { outline: { from: 'memory', key: 'outline' } },
        instructions: { template: 'Bad path: {{ outline.nope }}' },
      }),
    ];
    const issues = validator.validate({ graph, inputs: [], roles: [] });
    expect(hasError(issues, 'stages.b.instructions.template')).toBe(false);
    expect(hasError(issues, 'stages.c.instructions.template')).toBe(true);
  });

  it('errors when a template references an undeclared slot/context name', () => {
    const validator = makeValidator();
    const graph = [stage({ key: 'a', instructions: { template: '{{ nope }}' } })];
    expect(
      hasError(
        validator.validate({ graph, inputs: [], roles: [] }),
        'stages.a.instructions.template',
      ),
    ).toBe(true);
  });

  it('validates output instruction paths against the same bound schemas as the task template', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'source',
        output: {
          kind: 'data',
          schema: {
            type: 'object',
            properties: {
              beats: {
                type: 'array',
                items: { type: 'object', properties: { text: { type: 'string' } } },
              },
            },
          },
        },
        writes: { outline: '$' },
      }),
      stage({
        key: 'valid',
        context: { outline: { from: 'prev' } },
        output: {
          kind: 'text',
          instructions: 'Use {{ outline.beats[0].text }}. {{ priorCritique }}',
        },
      }),
      stage({
        key: 'invalid',
        context: { outline: { from: 'memory', key: 'outline' } },
        output: {
          kind: 'data',
          schema: { type: 'string' },
          instructions: '{{ outline.beats.text }}',
        },
      }),
    ];

    const issues = validator.validate({ graph, inputs: [], roles: [] });
    expect(hasError(issues, 'stages.valid.output.instructions')).toBe(false);
    expect(hasError(issues, 'stages.invalid.output.instructions')).toBe(true);
  });

  it('reports undeclared output-instruction bindings at the output instructions path', () => {
    const validator = makeValidator();
    const graph = [
      stage({ key: 'a', output: { kind: 'text', instructions: '{{ missing.value }}' } }),
    ];
    const issues = validator.validate({ graph, inputs: [], roles: [] });
    expect(hasError(issues, 'stages.a.output.instructions')).toBe(true);
  });

  it('warns when max_tokens is not visible at save time for a text-modality stage', () => {
    const validator = makeValidator();
    const graph = [
      stage({ key: 'a', model: { provider: 'fake', modelId: 'fake-text-1', params: {} } }),
    ];
    const issues = validator.validate({ graph, inputs: [], roles: [] });
    expect(hasWarning(issues, 'stages.a.model.params.max_tokens')).toBe(true);
  });

  it('does not warn about max_tokens when it is present', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'a',
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
      }),
    ];
    const issues = validator.validate({ graph, inputs: [], roles: [] });
    expect(hasWarning(issues, 'stages.a.model.params.max_tokens')).toBe(false);
  });

  it('warns when a memory key is written by more than one stage', () => {
    const validator = makeValidator();
    const graph = [
      stage({ key: 'a', writes: { shared: '$' } }),
      stage({ key: 'b', writes: { shared: '$' } }),
    ];
    expect(hasWarning(validator.validate({ graph, inputs: [], roles: [] }), 'memory.shared')).toBe(
      true,
    );
  });

  it('warns when a declared role is never bound by any stage', () => {
    const validator = makeValidator();
    const roles: RoleDef[] = [{ key: 'host', label: 'Host', required: false }];
    const issues = validator.validate({ graph: [stage({ key: 'a' })], inputs: [], roles });
    expect(hasWarning(issues, 'roles.host')).toBe(true);
  });

  it("errors when a script check's ref is unresolvable", () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'a',
        checks: [
          { type: 'script', name: 'x', code: 'true', refs: { r: { from: 'memory', key: 'nope' } } },
        ],
      }),
    ];
    expect(
      validator.validate({ graph, inputs: [], roles: [] }).some((i) => i.severity === 'error'),
    ).toBe(true);
  });

  it('errors on an unknown builtin check key (§16.2)', () => {
    const validator = makeValidator();
    const graph = [
      stage({ key: 'a', checks: [{ type: 'builtin', key: 'not_a_real_check', params: {} }] }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.checks[0].key'),
    ).toBe(true);
  });

  it("errors when a builtin check's params fail its schema (§16.2)", () => {
    const validator = makeValidator();
    const graph = [
      // array_length requires `path`; omitting it should fail param validation.
      stage({ key: 'a', checks: [{ type: 'builtin', key: 'array_length', params: {} }] }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.checks[0].params'),
    ).toBe(true);
  });

  it('passes a builtin check with valid params', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'a',
        checks: [{ type: 'builtin', key: 'non_empty', params: {} }],
      }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.checks[0]'),
    ).toBe(false);
  });

  it('errors when a script check fails to compile in the sandbox (§16.2)', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'a',
        checks: [{ type: 'script', name: 'broken', code: 'this is not valid js {{{' }],
      }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.checks[0].code'),
    ).toBe(true);
  });

  it('does not error on a script check that compiles cleanly', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'a',
        checks: [{ type: 'script', name: 'ok', code: 'return { pass: true };' }],
      }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.checks[0]'),
    ).toBe(false);
  });
});

/** Chunk 4 — `validateCheckDef` is the extracted, context-free half of the
 * per-check validation above (no graph/ctx needed), reused directly by
 * `TemplateService.save()` for `check`-kind templates. */
describe('BlueprintValidatorService.validateCheckDef', () => {
  it('errors on an unknown builtin check key', () => {
    const validator = makeValidator();
    const issues = validator.validateCheckDef(
      { type: 'builtin', key: 'not_a_real_check', params: {} },
      'body',
    );
    expect(issues.some((i) => i.severity === 'error' && i.path === 'body.key')).toBe(true);
  });

  it("errors when a builtin check's params fail its schema", () => {
    const validator = makeValidator();
    const issues = validator.validateCheckDef(
      { type: 'builtin', key: 'array_length', params: {} },
      'body',
    );
    expect(issues.some((i) => i.severity === 'error' && i.path.startsWith('body.params'))).toBe(
      true,
    );
  });

  it('errors when a script check fails to compile', () => {
    const validator = makeValidator();
    const issues = validator.validateCheckDef(
      { type: 'script', name: 'broken', code: 'this is not valid js {{{' },
      'body',
    );
    expect(issues.some((i) => i.severity === 'error' && i.path === 'body.code')).toBe(true);
  });

  it('passes a valid builtin check with no ref/ctx needed', () => {
    const validator = makeValidator();
    const issues = validator.validateCheckDef(
      { type: 'builtin', key: 'non_empty', params: {} },
      'body',
    );
    expect(issues).toEqual([]);
  });

  it('passes a script check that compiles cleanly, with no ref/ctx needed', () => {
    const validator = makeValidator();
    const issues = validator.validateCheckDef(
      { type: 'script', name: 'ok', code: 'return { pass: true };' },
      'body',
    );
    expect(issues).toEqual([]);
  });
});

describe('BlueprintValidatorService — iterate (Phase 7, §14/§16.2)', () => {
  beforeAll(async () => {
    await sandbox.ready();
  });

  const listInput: InputDef = {
    key: 'list',
    label: 'List',
    required: true,
    accepts: { kind: 'data', schema: { type: 'array', items: { type: 'string' } } },
  };
  const otherListInput: InputDef = {
    key: 'otherList',
    label: 'Other list',
    required: true,
    accepts: { kind: 'data', schema: { type: 'array', items: { type: 'string' } } },
  };

  it('a broll-shaped iterating stage passes with zero errors', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'shots',
        output: {
          kind: 'data',
          schema: {
            type: 'array',
            items: { type: 'object', properties: { text: { type: 'string' } } },
          },
        },
        writes: { shots: '$' },
      }),
      stage({
        key: 'broll',
        iterate: {
          over: { from: 'memory', key: 'shots' },
          itemAlias: 'shot',
          itemRetryLimit: 1,
        },
        context: { shot: { from: 'item' } },
      }),
    ];
    const issues = validator.validate({ graph, inputs: [], roles: [] });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('errors when iterate.over does not narrow to an array schema', () => {
    const validator = makeValidator();
    const graph = [
      stage({ key: 'txt', output: { kind: 'text' }, writes: { msg: '$' } }),
      stage({
        key: 'b',
        iterate: { over: { from: 'memory', key: 'msg' }, itemAlias: 'x', itemRetryLimit: 1 },
      }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.b.iterate.over'),
    ).toBe(true);
  });

  it('a const array iterate.over is valid (unalignable, but not an array-narrowing error)', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'b',
        iterate: { over: { from: 'const', value: ['a', 'b'] }, itemAlias: 'x', itemRetryLimit: 1 },
      }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.b.iterate.over'),
    ).toBe(false);
  });

  it('errors when iterate.over is a const that is not actually an array', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'b',
        iterate: {
          over: { from: 'const', value: 'not-an-array' },
          itemAlias: 'x',
          itemRetryLimit: 1,
        },
      }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.b.iterate.over'),
    ).toBe(true);
  });

  it('errors with a distinct message for a many-cardinality media iterate.over source', () => {
    const validator = makeValidator({ 'text.generate': llmGenerate, 'video.generate': videoGen });
    const graph = [
      stage({
        key: 'clip',
        capability: 'video.generate',
        output: { kind: 'media.video' },
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'i', itemRetryLimit: 1 },
        writes: { clips: '$' },
      }),
      stage({
        key: 'timeline',
        iterate: { over: { from: 'memory', key: 'clips' }, itemAlias: 'c', itemRetryLimit: 1 },
      }),
    ];
    const issues = validator.validate({ graph, inputs: [listInput], roles: [] });
    expect(
      issues.some(
        (i) =>
          i.severity === 'error' &&
          i.path === 'stages.timeline.iterate.over' &&
          i.message.includes('not yet supported'),
      ),
    ).toBe(true);
  });

  it('errors when a required slot binds {from:"prevItem"} — no config fallback escape hatch', () => {
    const validator = makeValidator({ 'text.generate': withRequiredSlot });
    const graph = [
      stage({
        key: 'a',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'x', itemRetryLimit: 1 },
        slots: { topic: { from: 'prevItem' } },
      }),
    ];
    expect(
      hasError(
        validator.validate({ graph, inputs: [listInput], roles: [] }),
        'stages.a.slots.topic',
      ),
    ).toBe(true);
  });

  it('does not error when an optional slot binds {from:"prevItem"}', () => {
    const validator = makeValidator({ 'text.generate': withOptionalSlot });
    const graph = [
      stage({
        key: 'a',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'x', itemRetryLimit: 1 },
        slots: { topic: { from: 'prevItem' } },
      }),
    ];
    expect(
      hasError(
        validator.validate({ graph, inputs: [listInput], roles: [] }),
        'stages.a.slots.topic',
      ),
    ).toBe(false);
  });

  it('errors when a context binding binds {from:"prevItem"} (context is always required)', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'a',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'x', itemRetryLimit: 1 },
        context: { note: { from: 'prevItem' } },
      }),
    ];
    expect(
      hasError(
        validator.validate({ graph, inputs: [listInput], roles: [] }),
        'stages.a.context.note',
      ),
    ).toBe(true);
  });

  it('errors when alignWith:"item" is used on a non-iterating consumer', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'p',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'x', itemRetryLimit: 1 },
      }),
      stage({ key: 'a', context: { prevOut: { from: 'prev', alignWith: 'item' } } }),
    ];
    expect(
      hasError(
        validator.validate({ graph, inputs: [listInput], roles: [] }),
        'stages.a.context.prevOut',
      ),
    ).toBe(true);
  });

  it('errors when alignWith:"item" is used but the previous stage does not iterate', () => {
    const validator = makeValidator();
    const graph = [
      stage({ key: 'p' }),
      stage({
        key: 'a',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'x', itemRetryLimit: 1 },
        context: { prevOut: { from: 'prev', alignWith: 'item' } },
      }),
    ];
    expect(
      hasError(
        validator.validate({ graph, inputs: [listInput], roles: [] }),
        'stages.a.context.prevOut',
      ),
    ).toBe(true);
  });

  it('errors when two aligned iterating stages have mismatched iterate.over Refs', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'p',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'x', itemRetryLimit: 1 },
      }),
      stage({
        key: 'a',
        iterate: {
          over: { from: 'input', inputKey: 'otherList' },
          itemAlias: 'y',
          itemRetryLimit: 1,
        },
        context: { prevOut: { from: 'prev', alignWith: 'item' } },
      }),
    ];
    expect(
      hasError(
        validator.validate({ graph, inputs: [listInput, otherListInput], roles: [] }),
        'stages.a.iterate.over',
      ),
    ).toBe(true);
  });

  it('passes when two aligned iterating stages share the same iterate.over Ref', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'p',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'x', itemRetryLimit: 1 },
      }),
      stage({
        key: 'a',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'y', itemRetryLimit: 1 },
        context: { prevOut: { from: 'prev', alignWith: 'item' } },
      }),
    ];
    const issues = validator.validate({ graph, inputs: [listInput], roles: [] });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('errors when {from:"prev"} (no alignWith) targets an iterating stage', () => {
    const validator = makeValidator();
    const graph = [
      stage({
        key: 'p',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'x', itemRetryLimit: 1 },
      }),
      stage({ key: 'a', context: { x: { from: 'prev' } } }),
    ];
    expect(
      hasError(validator.validate({ graph, inputs: [listInput], roles: [] }), 'stages.a.context.x'),
    ).toBe(true);
  });

  it('errors when a cardinality:"one" slot binds a memory group written by an iterating stage', () => {
    const validator = makeValidator({ 'text.generate': withRequiredSlot });
    const graph = [
      stage({
        key: 'p',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'x', itemRetryLimit: 1 },
        writes: { snippets: '$' },
      }),
      stage({ key: 'a', slots: { topic: { from: 'memory', key: 'snippets' } } }),
    ];
    expect(
      hasError(
        validator.validate({ graph, inputs: [listInput], roles: [] }),
        'stages.a.slots.topic',
      ),
    ).toBe(true);
  });

  it('errors when a cardinality:"many" slot binds {from:"item"}', () => {
    const validator = makeValidator({ 'text.generate': withManySlot });
    const graph = [
      stage({
        key: 'a',
        iterate: { over: { from: 'input', inputKey: 'list' }, itemAlias: 'x', itemRetryLimit: 1 },
        slots: { items: { from: 'item' } },
      }),
    ];
    const issues = validator.validate({ graph, inputs: [listInput], roles: [] });
    expect(
      issues.some(
        (i) =>
          i.severity === 'error' &&
          i.path === 'stages.a.slots.items' &&
          i.message.includes("cardinality:'many'"),
      ),
    ).toBe(true);
  });
});
