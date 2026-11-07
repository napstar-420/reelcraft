import { describe, expect, it } from 'vitest';
import { BROWSEROS_NEO_SKILL } from '../../common/browseros-neo-skill';
import { buildJobPrompt } from './cli-job-prompt';

describe('browser job skill', () => {
  it('always supplies the bundled Neo skill and scoped SDK guidance to browser jobs', () => {
    const prompt = buildJobPrompt({ modality: 'browser', renderedPrompt: 'Research a topic.' });
    expect(prompt).toContain(BROWSEROS_NEO_SKILL);
    expect(prompt).toContain('Execution binding for browser automation stages');
    expect(prompt).toContain('page.cdp(method, JSON.stringify(params))');
    expect(prompt).toContain('Do not manually attach or detach CDP targets');
    expect(prompt).toContain('Maximum browser steps: 500');
    expect(prompt).toContain('return the supplied manifest');
  });

  it.each(['text', 'image', 'code'] as const)(
    'does not add browser access to %s jobs',
    (modality) => {
      expect(buildJobPrompt({ modality })).not.toContain('<browseros_neo_skill>');
    },
  );
});
