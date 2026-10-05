import { describe, expect, it } from 'vitest';
import {
  inheritedDefaults,
  isResolution,
  parseAmount,
  parseWhole,
  setFormat,
  setKindModel,
  setRetryLimit,
  setStageCap,
} from './defaults-editor.logic';

describe('defaults editor', () => {
  it('sets and clears a default model per kind, dropping empty groups', () => {
    const withText = setKindModel({}, 'text', { provider: 'fake', modelId: 'fake-text-1' });
    expect(withText).toEqual({ models: { text: { provider: 'fake', modelId: 'fake-text-1' } } });
    // No provider picked counts as unset.
    expect(setKindModel(withText, 'text', { modelId: 'x' })).toEqual({});
    expect(setKindModel(withText, 'text', undefined)).toEqual({});
  });

  it('sets and clears retries, stage cap and format fields', () => {
    expect(setRetryLimit({}, 2)).toEqual({ retryLimit: 2 });
    expect(setRetryLimit({ retryLimit: 2 }, undefined)).toEqual({});
    expect(setStageCap({}, 0.5)).toEqual({ budget: { stageCapUsd: 0.5 } });
    expect(setStageCap({ budget: { stageCapUsd: 1, runCapUsd: 3 } }, undefined)).toEqual({
      budget: { runCapUsd: 3 },
    });
    const format = setFormat({}, 'aspectRatio', '9:16');
    expect(setFormat(format, 'fps', 30)).toEqual({ format: { aspectRatio: '9:16', fps: 30 } });
    expect(setFormat(format, 'aspectRatio', undefined)).toEqual({});
  });

  it('parses inputs', () => {
    expect(parseWhole('')).toBeUndefined();
    expect(parseWhole('3')).toBe(3);
    expect(parseWhole('1.5')).toBeUndefined();
    expect(parseWhole('0', 1)).toBeUndefined();
    expect(parseAmount('0.25')).toBe(0.25);
    expect(parseAmount('0')).toBeUndefined();
    expect(isResolution('1080x1920')).toBe(true);
    expect(isResolution('')).toBe(true);
    expect(isResolution('1080x')).toBe(false);
  });

  it('works out what a stage inherits: blueprint over channel over engine', () => {
    expect(inheritedDefaults({}, {})).toEqual({ retryLimit: 0, models: {} });
    const text = { provider: 'fake', modelId: 'a' };
    const image = { provider: 'fal', modelId: 'b' };
    expect(
      inheritedDefaults(
        { retryLimit: 1, budget: { stageCapUsd: 2 }, models: { text, image } },
        { retryLimit: 3, models: { text: image } },
      ),
    ).toEqual({ retryLimit: 3, stageCapUsd: 2, models: { text: image, image } });
  });
});
