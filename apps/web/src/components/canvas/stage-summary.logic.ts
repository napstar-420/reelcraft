import type { Ref, StageDef } from '@reelcraft/shared';
import { stageDependencies } from '@/lib/stage-deps';
import { stageDisplayName } from '@/lib/stage-display-name';

const nameOf = (stage: StageDef | undefined, key: string) =>
  stage ? stageDisplayName(stage) : key || 'another stage';

/** Where a repeating stage's items come from, in a few words. */
function iterationSource(over: Ref, byKey: Map<string, StageDef>): string {
  switch (over.from) {
    case 'stage':
      return nameOf(byKey.get(over.stageKey), over.stageKey);
    case 'prev':
      return 'the previous stage';
    case 'input':
      return 'an input';
    case 'memory':
      return 'run memory';
    case 'const':
      return 'a fixed list';
    case 'asset':
    case 'library':
      return 'the library';
    default:
      return 'its source';
  }
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** A few plain sentences saying what a stage does: what it is, what it waits for, whether it
 * repeats, what it must pass and whether a person checks it. Shown above the stage's settings. */
export function stageSummary(
  graph: StageDef[],
  stageKey: string,
  capabilityLabel: (capability: string) => string,
): string[] {
  const stage = graph.find((s) => s.key === stageKey);
  if (!stage) return [];
  const byKey = new Map(graph.map((s) => [s.key, s]));
  const sentences: string[] = [];
  if (stage.disabled)
    sentences.push('Turned off: it keeps its last output, but later stages cannot use it.');

  let what = `${capabilityLabel(stage.capability)}`;
  if (stage.model?.modelId) what += ` with ${stage.model.modelId}`;
  const over = stage.iterate?.over;
  if (stage.iterate && over) {
    const source = iterationSource(over, byKey);
    what += `, once for each ${stage.iterate.itemAlias} from ${source}`;
    if (stage.iterate.concurrency && stage.iterate.concurrency > 1)
      what += `, ${stage.iterate.concurrency} at a time`;
  }
  sentences.push(`${what}.`);

  const deps = stageDependencies(graph).get(stage.key) ?? [];
  sentences.push(
    deps.length
      ? `Runs after ${list(deps.map((k) => nameOf(byKey.get(k), k)))}.`
      : 'Runs first: it waits for nothing.',
  );

  const gates: string[] = [];
  if (stage.checks.length)
    gates.push(`${stage.checks.length} check${stage.checks.length === 1 ? '' : 's'}`);
  if (stage.qc) gates.push('an AI quality review');
  if (gates.length) sentences.push(`Every result must pass ${list(gates)} before it is kept.`);
  if (stage.approval) sentences.push('Waits for your approval before the run carries on.');
  if (stage.budget?.stageCapUsd)
    sentences.push(`Stops if it would spend more than $${stage.budget.stageCapUsd.toFixed(2)}.`);
  return sentences;
}
