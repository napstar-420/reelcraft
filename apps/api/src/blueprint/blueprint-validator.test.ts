import { describe, expect, it } from 'vitest';
import type { InputDef, RoleDef, StageDef } from '@reefcraft/shared';
import type { CapabilityImpl } from '../capability/capability.interface';
import type { CapabilityRegistry } from '../capability/capability.registry';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { HELLO_STAGE_GRAPH } from '../template/template-seed.service';
import { BlueprintValidatorService } from './blueprint-validator.service';

function stage(overrides: Partial<StageDef> & Pick<StageDef, 'key'>): StageDef {
  return {
    label: overrides.key,
    capability: 'llm.generate',
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
  capabilities: Record<string, CapabilityImpl> = { 'llm.generate': llmGenerate },
) {
  return new BlueprintValidatorService(fakeRegistry(capabilities), new SchemaValidatorService());
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
    const validator = makeValidator({ 'llm.generate': capability });
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
      'llm.generate': { ...llmGenerate, allowedOutputs: () => ['media.video'] },
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

  it('errors on a required slot left unbound', () => {
    const validator = makeValidator({ 'llm.generate': withRequiredSlot });
    const graph = [stage({ key: 'a' })];
    expect(
      hasError(validator.validate({ graph, inputs: [], roles: [] }), 'stages.a.slots.topic'),
    ).toBe(true);
  });

  it('errors when a bound slot is structurally incompatible', () => {
    const validator = makeValidator({ 'llm.generate': withRequiredSlot });
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
    const validator = makeValidator({ 'llm.generate': withRequiredSlot });
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

  it('errors naming the right phase for asset/item/prevItem refs', () => {
    const validator = makeValidator();
    const assetIssues = validator.validate({
      graph: [stage({ key: 'a', context: { x: { from: 'asset', assetId: 'x' } } })],
      inputs: [],
      roles: [],
    });
    expect(assetIssues.some((i) => i.severity === 'error' && i.message.includes('phase 4'))).toBe(
      true,
    );

    const itemIssues = validator.validate({
      graph: [stage({ key: 'a', context: { x: { from: 'item' } } })],
      inputs: [],
      roles: [],
    });
    expect(itemIssues.some((i) => i.severity === 'error' && i.message.includes('phase 7'))).toBe(
      true,
    );
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
});
