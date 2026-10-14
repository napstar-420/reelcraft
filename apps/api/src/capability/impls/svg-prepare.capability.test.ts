import { describe, expect, it, vi } from 'vitest';
import { SvgPrepareCapability } from './svg-prepare.capability';

const capability = new SvgPrepareCapability();
const drawing = (id: string) => ({
  id,
  strokes: [{ d: 'M 20 20 L 80 20 L 80 80 Z' }],
});

const run = async (slots: Record<string, unknown>) => {
  const log = vi.fn();
  const ctx = {
    runId: 'r',
    stageKey: 'prepare',
    attemptNo: 1,
    config: {},
    slots,
    context: {},
    idempotencyKey: 'key',
    logger: { log, error: vi.fn() },
  } as never;
  const result = await capability.fetch(await capability.submit(ctx), ctx);
  return { result, log };
};

describe('SvgPrepareCapability', () => {
  it('takes the drawings, and the plan for their labels, and makes a data output', () => {
    expect(capability.slots().map((slot) => [slot.name, slot.required])).toEqual([
      ['drawings', true],
      ['scenes', false],
    ]);
    expect(capability.allowedOutputs()).toEqual(['data']);
    expect(capability.modality).toBe('compute');
  });

  it('gathers usable drawings into a set at no cost', async () => {
    const { result } = await run({
      drawings: [drawing('mug'), drawing('bulb')],
      scenes: { assetNeeds: [{ id: 'mug', label: 'A mug', description: 'x' }] },
    });
    expect(result.costUsd).toBe(0);
    expect(result.output).toMatchObject({
      assets: [
        { id: 'mug', label: 'A mug', source: 'generated', viewBox: { width: 100, height: 100 } },
        { id: 'bulb', label: 'bulb' },
      ],
    });
    expect(result.providerMeta).toMatchObject({ received: 2, accepted: 2, rejected: [] });
  });

  it('takes the answers of an iterating stage as a list, or in an object', async () => {
    const list = await run({ drawings: [drawing('a')] });
    const wrapped = await run({ drawings: { drawings: [drawing('a')] } });
    expect(list.result.output).toEqual(wrapped.result.output);
  });

  it('leaves out a drawing it cannot use and says so in the log, keeping the rest', async () => {
    const { result, log } = await run({
      drawings: [drawing('good'), { id: 'bad', strokes: [{ d: 'M 0 0 L 900 900' }] }],
    });
    expect(result.output).toMatchObject({ assets: [{ id: 'good' }] });
    expect(result.providerMeta).toMatchObject({
      accepted: 1,
      rejected: [{ id: 'bad', issues: [{ code: 'bad_path' }] }],
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('left out "bad"'));
  });

  it('makes an empty set rather than failing when nothing is usable', async () => {
    const { result } = await run({ drawings: [{ id: 'bad', strokes: [] }] });
    expect(result.output).toEqual({ assets: [] });
    expect(result.modelError).toBeUndefined();
  });

  it('ignores a plan with bad needs', async () => {
    const { result } = await run({ drawings: [drawing('a')], scenes: { assetNeeds: 'nope' } });
    expect(result.output).toMatchObject({ assets: [{ id: 'a', label: 'a' }] });
  });

  it('checks the stage', () => {
    const stage = (overrides: Record<string, unknown> = {}) =>
      ({ output: { kind: 'data' }, ...overrides }) as never;
    expect(capability.validate({}, stage())).toEqual([]);
    expect(capability.validate({}, stage({ output: { kind: 'text' } }))[0]).toMatchObject({
      path: 'output.kind',
    });
    expect(
      capability.validate({}, stage({ iterate: { over: { from: 'input', inputKey: 'x' } } }))[0],
    ).toMatchObject({ path: 'iterate' });
  });
});
