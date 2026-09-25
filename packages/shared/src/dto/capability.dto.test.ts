import { describe, expect, it } from 'vitest';
import { ModelInfoDto } from './capability.dto';

describe('ModelInfoDto', () => {
  it('accepts plural text, image, and browser modalities', () => {
    expect(
      ModelInfoDto.parse({
        providerId: 'codex',
        modelId: 'gpt-example',
        label: 'Example',
        modalities: ['text', 'image', 'browser'],
      }).modalities,
    ).toEqual(['text', 'image', 'browser']);
  });
});
