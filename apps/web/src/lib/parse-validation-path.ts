export type ParsedValidationPath = {
  stageKey?: string;
  region?:
    | 'stage'
    | 'slots'
    | 'context'
    | 'config'
    | 'checks'
    | 'output'
    | 'approval'
    | 'capability'
    | 'model'
    | 'qc'
    | 'iterate'
    | 'enabledWhen'
    | 'instructions';
  name?: string;
  raw: string;
};

const CHECKS_SEGMENT = /^checks\[(\d+)\]$/;

/**
 * Locked Decision 8 — maps a `blueprint-validator.service.ts` `ValidationIssue.path`
 * onto the node/field it's about, purely for UI placement (never re-decides
 * validity — that stays server-authoritative). Every shape it doesn't
 * recognize still falls back to `{raw: path}` instead of throwing, since the
 * validator's path shapes can grow independently of this file.
 */
export function parseValidationPath(path: string): ParsedValidationPath {
  const parts = path.split('.');
  if (parts[0] !== 'stages' || !parts[1]) {
    return { raw: path };
  }
  const stageKey = parts[1];
  if (parts.length === 2) {
    return { stageKey, region: 'stage', raw: path };
  }

  const checksMatch = CHECKS_SEGMENT.exec(parts[2] ?? '');
  if (checksMatch) {
    const index = checksMatch[1] ?? '';
    const rest = parts.slice(3).join('.');
    return { stageKey, region: 'checks', name: rest ? `${index}.${rest}` : index, raw: path };
  }

  const region = parts[2];
  const rest = parts.slice(3).join('.');
  switch (region) {
    case 'slots':
    case 'context':
    case 'config':
    case 'output':
    case 'approval':
    case 'model':
    case 'iterate':
    case 'enabledWhen':
    case 'instructions':
      return rest ? { stageKey, region, name: rest, raw: path } : { stageKey, region, raw: path };
    case 'capability':
    case 'qc':
      return { stageKey, region, raw: path };
    default:
      // e.g. `checkFirstStagePrev`'s bare `stages.<key>.<slotOrContextName>`
      // — a real shape the validator emits, just not one that names its own
      // region; keep the stage attribution, drop the (unknown) region.
      return { stageKey, name: parts.slice(2).join('.'), raw: path };
  }
}
