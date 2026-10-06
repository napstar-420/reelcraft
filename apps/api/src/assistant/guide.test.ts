import { describe, expect, it } from 'vitest';
import { ArtifactKind, Ref } from '@reelcraft/shared';
import { BUILTIN_CHECKS } from '../check/builtins/index';
import { BlueprintValidatorService } from '../blueprint/blueprint-validator.service';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { realCapabilities, realCapabilityRegistry } from './tools/test-support';
import {
  GUIDE,
  GUIDE_TOPICS,
  exampleScenesToImages,
  exampleScript,
  exampleVoiceover,
  readGuide,
} from './guide';

const guideText = Object.values(GUIDE)
  .map((section) => section.body)
  .join('\n');

/** A name counts as covered only when it appears as inline code (`name`). */
const covered = (name: string) =>
  guideText.includes(`\`${name}\``) || guideText.includes(`'${name}'`);

function refKinds(): string[] {
  const options = (Ref as unknown as { options: Array<{ shape: { from: { value: string } } }> })
    .options;
  return options.map((o) => o.shape.from.value);
}

describe('assistant guide coverage', () => {
  it('has the sections the assistant is told to read', () => {
    expect(GUIDE_TOPICS).toEqual(
      expect.arrayContaining(['overview', 'refs', 'limits', 'models', 'examples']),
    );
    expect(readGuide('nope')).toBeUndefined();
  });

  it('mentions every registered capability', () => {
    const keys = realCapabilities().map((c) => c.key);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.filter((k) => !covered(k))).toEqual([]);
  });

  it('mentions every builtin check', () => {
    expect(Object.keys(BUILTIN_CHECKS).filter((k) => !covered(k))).toEqual([]);
  });

  it('mentions every Ref kind', () => {
    const kinds = refKinds();
    expect(kinds).toHaveLength(9);
    expect(kinds.filter((k) => !covered(k) && !guideText.includes(`from:'${k}'`))).toEqual([]);
  });

  it('mentions every artifact kind', () => {
    expect(ArtifactKind.options.filter((k) => !covered(k))).toEqual([]);
  });

  it('calls out what Reelcraft cannot do', () => {
    const limits = GUIDE.limits!.body.toLowerCase();
    for (const phrase of ['publish.stub', 'parallel', 'enabledwhen', 'groupkey', 'role']) {
      expect(limits).toContain(phrase);
    }
  });
});

describe('assistant guide examples', () => {
  const validator = new BlueprintValidatorService(
    realCapabilityRegistry(),
    new SchemaValidatorService(),
    {} as never, // only script checks use the sandbox, and the examples have none
  );

  it.each([
    ['script', exampleScript],
    ['scenes to images', exampleScenesToImages],
    ['voice-over', exampleVoiceover],
  ])('example "%s" has no validation errors', (_name, make) => {
    const draft = make();
    const issues = validator.validate({
      graph: draft.graph,
      inputs: draft.inputs,
      roles: draft.roles,
    });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
