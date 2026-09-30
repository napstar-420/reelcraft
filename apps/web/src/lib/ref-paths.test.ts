import { describe, expect, it } from 'vitest';
import type { InputDef, JsonSchema, StageDef } from '@reelcraft/shared';
import { pathSuggestions, schemaPaths } from './ref-paths';

const script: JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    beats: {
      type: 'array',
      items: { type: 'object', properties: { line: { type: 'string' } } },
    },
  },
};

function stage(key: string, extra: Partial<StageDef> = {}): StageDef {
  return {
    key,
    label: key,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    ...extra,
  } as StageDef;
}

const paths = (list: ReturnType<typeof pathSuggestions>) => list?.map((s) => s.path);

describe('schemaPaths', () => {
  it('lists nested fields, addressing arrays by index 0', () => {
    expect(schemaPaths(script)).toEqual([
      { path: 'title', type: 'string' },
      { path: 'beats', type: 'array' },
      { path: 'beats.0', type: 'object' },
      { path: 'beats.0.line', type: 'string' },
    ]);
  });
});

describe('pathSuggestions', () => {
  const writer = stage('script', {
    output: { kind: 'data', schema: script },
    writes: { beats: 'beats' },
  });
  const graph = [
    writer,
    stage('caption'),
    stage('shots', { iterate: { over: { from: 'memory', key: 'beats' } } } as Partial<StageDef>),
  ];
  const inputs: InputDef[] = [
    { key: 'brief', label: 'Brief', required: true, accepts: { kind: 'data', schema: script } },
    { key: 'topic', label: 'Topic', required: true, accepts: { kind: 'text' } },
  ];

  it('offers the previous data output, and nothing for a text one', () => {
    expect(paths(pathSuggestions({ from: 'prev' }, graph, 1, inputs))).toContain('beats.0.line');
    expect(pathSuggestions({ from: 'prev' }, graph, 2, inputs)).toBeNull();
  });

  it('narrows a memory key by its writer path', () => {
    expect(paths(pathSuggestions({ from: 'memory', key: 'beats' }, graph, 1, inputs))).toEqual([
      '0',
      '0.line',
    ]);
    expect(pathSuggestions({ from: 'memory', key: 'nope' }, graph, 1, inputs)).toBeUndefined();
  });

  it('reads data inputs, and nothing for text inputs', () => {
    expect(
      paths(pathSuggestions({ from: 'input', inputKey: 'brief' }, graph, 0, inputs)),
    ).toContain('title');
    expect(pathSuggestions({ from: 'input', inputKey: 'topic' }, graph, 0, inputs)).toBeNull();
  });

  it('offers item fields from iterate.over, and frames for a video prevItem', () => {
    expect(paths(pathSuggestions({ from: 'item' }, graph, 2, inputs))).toEqual(['line']);
    const video = [stage('clips', { output: { kind: 'media.video' } })];
    expect(paths(pathSuggestions({ from: 'prevItem' }, video, 0, []))).toEqual([
      'lastFrame',
      'firstFrame',
    ]);
  });
});
