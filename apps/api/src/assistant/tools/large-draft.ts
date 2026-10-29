import type { CreateBlueprintVersionDto, StageDef } from '@reelcraft/shared';

/** A realistic big blueprint for tests and the live acceptance: 31 stages with long prompts,
 * about 150,000 characters (what broke the assistant). Stages 21 and 27 are Human input
 * stages that gate the stages after them, like a production pipeline's manual reviews. */
export function largeDraft(promptChars = 4_800): CreateBlueprintVersionDto {
  const prompt = (n: number) =>
    `Stage ${n} guidance. `.padEnd(promptChars, 'Keep every sentence concrete, visual and short. ');
  const graph: StageDef[] = Array.from({ length: 31 }, (_, i) => {
    const n = i + 1;
    const key = `s${String(n).padStart(2, '0')}`;
    const human = n === 21 || n === 27;
    return {
      key,
      label: `Step ${n}`,
      capability: human ? 'human.input' : 'text.generate',
      ...(human
        ? {}
        : {
            instructions: { system: `You are step ${n} of a video pipeline.`, template: prompt(n) },
          }),
      config: {},
      slots: {},
      context:
        n === 22
          ? { licences: { from: 'memory', key: 'licences' } }
          : n === 28
            ? { approval: { from: 'memory', key: 'approval' } }
            : {},
      ...(n === 21 ? { writes: { licences: '$' } } : n === 27 ? { writes: { approval: '$' } } : {}),
      output: { kind: 'text' },
      checks: [],
      ...(n === 22 ? { dependsOn: ['s21'] } : n === 28 ? { dependsOn: ['s27'] } : {}),
    } as StageDef;
  });
  return {
    graph,
    inputs: [],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 20 },
    presentation: {
      positions: Object.fromEntries(graph.map((s, i) => [s.key, { x: i * 300, y: 0 }])),
      branchNames: {},
    },
  };
}
