import { describe, expect, it } from 'vitest';
import { CreateVersionQueryDto, UpdateBlueprintDto } from './blueprint.dto';

describe('blueprint version numbering', () => {
  it('defaults a save to a minor bump and rejects unknown bumps', () => {
    expect(CreateVersionQueryDto.parse({})).toEqual({ bump: 'minor' });
    expect(CreateVersionQueryDto.parse({ bump: 'major' })).toEqual({ bump: 'major' });
    expect(() => CreateVersionQueryDto.parse({ bump: 'patch' })).toThrow();
  });
});

describe('UpdateBlueprintDto', () => {
  it('accepts an empty patch and each field on its own', () => {
    expect(UpdateBlueprintDto.parse({})).toEqual({});
    expect(UpdateBlueprintDto.parse({ name: 'Renamed' }).name).toBe('Renamed');
    expect(UpdateBlueprintDto.parse({ description: null }).description).toBeNull();
    expect(UpdateBlueprintDto.parse({ tags: ['a', 'b'] }).tags).toEqual(['a', 'b']);
  });

  it('rejects an empty name', () => {
    expect(() => UpdateBlueprintDto.parse({ name: '' })).toThrow();
  });

  it('rejects a name over 120 characters', () => {
    expect(() => UpdateBlueprintDto.parse({ name: 'a'.repeat(121) })).toThrow();
    expect(UpdateBlueprintDto.parse({ name: 'a'.repeat(120) }).name).toHaveLength(120);
  });

  it('rejects a description over 500 characters', () => {
    expect(() => UpdateBlueprintDto.parse({ description: 'a'.repeat(501) })).toThrow();
    expect(UpdateBlueprintDto.parse({ description: 'a'.repeat(500) }).description).toHaveLength(
      500,
    );
  });

  it('rejects more than 20 tags', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    expect(() => UpdateBlueprintDto.parse({ tags })).toThrow();
    expect(UpdateBlueprintDto.parse({ tags: tags.slice(0, 20) }).tags).toHaveLength(20);
  });

  it('rejects a tag over 32 characters and trims whitespace', () => {
    expect(() => UpdateBlueprintDto.parse({ tags: ['a'.repeat(33)] })).toThrow();
    expect(UpdateBlueprintDto.parse({ tags: ['  spaced  '] }).tags).toEqual(['spaced']);
  });

  it('rejects an empty-string tag', () => {
    expect(() => UpdateBlueprintDto.parse({ tags: [''] })).toThrow();
    expect(() => UpdateBlueprintDto.parse({ tags: ['   '] })).toThrow();
  });
});
