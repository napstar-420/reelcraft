import { describe, expect, it } from 'vitest';
import { InstantiateTemplateDto, SaveTemplateDto } from './template.dto';

describe('SaveTemplateDto', () => {
  it('rejects an empty name', () => {
    expect(() =>
      SaveTemplateDto.parse({ kind: 'schema', name: '', body: { type: 'object' } }),
    ).toThrow();
  });

  it('accepts a non-empty name with defaulted meta fields', () => {
    const parsed = SaveTemplateDto.parse({
      kind: 'schema',
      name: 'My Schema',
      body: { type: 'object' },
    });
    expect(parsed).toMatchObject({ name: 'My Schema', description: '', tags: [] });
  });
});

describe('InstantiateTemplateDto', () => {
  it('accepts an empty body — non-blueprint kinds ignore both fields', () => {
    expect(InstantiateTemplateDto.parse({})).toEqual({});
  });

  it('accepts a channelId/runCapUsd pair for a blueprint-kind instantiate', () => {
    expect(InstantiateTemplateDto.parse({ channelId: 'chan1', runCapUsd: 5 })).toEqual({
      channelId: 'chan1',
      runCapUsd: 5,
    });
  });

  it('rejects a non-positive runCapUsd', () => {
    expect(() => InstantiateTemplateDto.parse({ runCapUsd: 0 })).toThrow();
    expect(() => InstantiateTemplateDto.parse({ runCapUsd: -5 })).toThrow();
  });

  it('rejects an empty channelId', () => {
    expect(() => InstantiateTemplateDto.parse({ channelId: '' })).toThrow();
  });
});
