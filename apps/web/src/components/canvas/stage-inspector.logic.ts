import type { JsonSchema, OutputDef, OutputKind, StageDef } from '@reelcraft/shared';
import type { ParsedValidationPath } from '../../lib/parse-validation-path';
import { speechPinSummary } from './speech/speech-settings.logic';

function outputInstructions(output: OutputDef): string | undefined {
  return output.kind === 'text' || output.kind === 'data' ? output.instructions : undefined;
}

export function buildStageOutput(kind: OutputKind, previous: OutputDef): OutputDef {
  const instructions = outputInstructions(previous);

  switch (kind) {
    case 'data':
      return {
        kind: 'data',
        schema: previous.kind === 'data' ? previous.schema : { type: 'object' },
        schemaName: previous.kind === 'data' ? previous.schemaName : undefined,
        instructions,
      };
    case 'text':
      return { kind: 'text', instructions };
    case 'media.image':
    case 'media.video':
    case 'media.audio':
    case 'media.video_list':
    case 'media.image_list':
      return { kind };
    case 'file.subtitles':
      return { kind: 'file.subtitles' };
    case 'timeline':
      return { kind: 'timeline' };
  }
}

export function supportsOutputInstructions(
  capability: string,
  output: OutputDef,
): output is Extract<OutputDef, { kind: 'text' | 'data' }> {
  return capability === 'text.generate' && (output.kind === 'text' || output.kind === 'data');
}

export function updateDataOutputSchema(
  output: Extract<OutputDef, { kind: 'data' }>,
  schema: JsonSchema | undefined,
): Extract<OutputDef, { kind: 'data' }> {
  return { ...output, schema: schema ?? { type: 'object' } };
}

export function isOutputInstructionsIssue(path: ParsedValidationPath): boolean {
  return path.region === 'output' && path.name === 'instructions';
}

/** Switches an output schema's `type`, keeping `description` but dropping the
 * previous type's fields (a stale `items` left over from an old array, say)
 * rather than carrying them into a shape that no longer uses them. */
export function retypeSchema(schema: JsonSchema, type: JsonSchema['type']): JsonSchema {
  const base: JsonSchema = { type, description: schema.description };
  if (type === 'object') return { ...base, properties: {} };
  if (type === 'array') return { ...base, items: { type: 'string' } };
  return base;
}

/** A one-line description of a schema's shape, for a collapsed property
 * row's summary — not used for anything but display. */
export function summarizeSchema(schema: JsonSchema): string {
  if (schema.type === 'array')
    return `array of ${summarizeSchema(schema.items ?? { type: 'string' })}`;
  if (schema.type === 'object') {
    const count = Object.keys(schema.properties ?? {}).length;
    return `object · ${count} ${count === 1 ? 'property' : 'properties'}`;
  }
  return schema.type;
}

const SCHEMA_KEYS = new Set([
  'type',
  'enum',
  'description',
  'properties',
  'required',
  'items',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
]);
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);
const NUMERIC_KEYS = [
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
] as const;

/** A structural check against the restricted `JsonSchema` dialect (§4.2),
 * written locally rather than importing the shared package's Zod schema as a
 * runtime value — Vite's dev-time CJS interop doesn't reliably pick up
 * runtime exports re-exported through `packages/shared`'s `__exportStar`
 * barrel (the same limitation `formatBlueprintVersion` hit earlier), so
 * every value from `@reelcraft/shared` used in `apps/web` today is a
 * compile-time type import only; this keeps that true. */
function isJsonSchemaShape(value: unknown): value is JsonSchema {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (!Object.keys(obj).every((key) => SCHEMA_KEYS.has(key))) return false;
  if (typeof obj.type !== 'string' || !SCHEMA_TYPES.has(obj.type)) return false;
  if (obj.description !== undefined && typeof obj.description !== 'string') return false;
  if (
    obj.enum !== undefined &&
    (!Array.isArray(obj.enum) ||
      !obj.enum.every((v) => typeof v === 'string' || typeof v === 'number'))
  )
    return false;
  if (
    obj.required !== undefined &&
    (!Array.isArray(obj.required) || !obj.required.every((v) => typeof v === 'string'))
  )
    return false;
  if (obj.properties !== undefined) {
    if (typeof obj.properties !== 'object' || obj.properties === null) return false;
    if (!Object.values(obj.properties).every(isJsonSchemaShape)) return false;
  }
  if (obj.items !== undefined && !isJsonSchemaShape(obj.items)) return false;
  for (const key of NUMERIC_KEYS) {
    if (obj[key] !== undefined && typeof obj[key] !== 'number') return false;
  }
  return true;
}

/** Parses and validates a raw-JSON edit of an output schema (the "Raw JSON"
 * tab), rejecting anything that isn't valid JSON or doesn't match the
 * restricted `JsonSchema` dialect (§4.2) — e.g. an unknown key. */
export function parseSchemaJson(
  text: string,
): { ok: true; schema: JsonSchema } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not valid JSON.' };
  }
  if (!isJsonSchemaShape(parsed)) {
    return { ok: false, error: 'That is not a valid schema.' };
  }
  return { ok: true, schema: parsed };
}

/** Infers an output schema from a sample JSON value (from a pasted object),
 * so authors can build a schema by example instead of field-by-field. The
 * dialect (§4.2) has no null type, so `null`/`undefined` fall back to
 * `string` — a known limitation, not solved here. */
export function inferSchemaFromValue(value: unknown): JsonSchema {
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: value.length > 0 ? inferSchemaFromValue(value[0]) : { type: 'string' },
    };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type: 'object',
      properties: Object.fromEntries(entries.map(([key, v]) => [key, inferSchemaFromValue(v)])),
      required: entries.map(([key]) => key),
    };
  }
  return { type: 'string' };
}

export type StageSectionSummaries = Record<
  'basics' | 'data' | 'output-writes' | 'checks-qc' | 'model' | 'execution' | 'flow',
  string
>;

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** One short line per inspector section, shown on its collapsed header so a
 * stage's shape can be read without opening anything. */
export function stageSectionSummaries(stage: StageDef): StageSectionSummaries {
  const writes = Object.keys(stage.writes ?? {});
  const slots = Object.keys(stage.slots).length;
  const context = Object.keys(stage.context).length;
  const execution = [
    stage.retryLimit !== undefined ? `retry ${stage.retryLimit}` : '',
    stage.budget?.stageCapUsd !== undefined ? `cap $${stage.budget.stageCapUsd}` : '',
  ].filter(Boolean);
  const flow = [
    stage.enabledWhen ? 'conditional' : '',
    stage.approval ? 'approval' : '',
    stage.iterate ? 'per item' : '',
  ].filter(Boolean);
  return {
    basics: stage.capability,
    data: context > 0 ? `${count(slots, 'slot')}, ${context} context` : count(slots, 'slot'),
    'output-writes':
      writes.length > 0 ? `${stage.output.kind} → ${writes.join(', ')}` : stage.output.kind,
    'checks-qc': stage.qc
      ? `${count(stage.checks.length, 'check')}, QC on`
      : count(stage.checks.length, 'check'),
    model:
      stage.capability === 'audio.speech'
        ? speechPinSummary(stage.model)
        : (stage.model?.modelId ?? stage.model?.provider ?? 'Inherited'),
    execution: execution.length > 0 ? execution.join(', ') : 'Defaults',
    flow: flow.length > 0 ? flow.join(', ') : 'Runs once',
  };
}

/** The Flow stage's extra ingredient inputs are a count in its config, added
 * and removed with buttons rather than typed, so the number stays out of the
 * Config form. The slots are `ingredients`, `ingredients2`, `ingredients3`… */
export const FLOW_CAPABILITY = 'browser.flow_video';
const INGREDIENT_COUNT_KEY = 'ingredientSlots';
const ACCOUNTS_KEY = 'accounts';
const DEFAULT_INGREDIENTS = 1;
export const MAX_INGREDIENTS = 8;

export function ingredientSlotName(position: number): string {
  return position <= 1 ? 'ingredients' : `ingredients${position}`;
}

export function ingredientCount(config: Record<string, unknown>): number {
  const count = config[INGREDIENT_COUNT_KEY];
  return typeof count === 'number' ? count : DEFAULT_INGREDIENTS;
}

/** The stage with `count` ingredient inputs; bindings of inputs that no
 * longer exist are dropped. */
export function withIngredientCount(stage: StageDef, count: number): StageDef {
  const next = Math.min(Math.max(count, 0), MAX_INGREDIENTS);
  const keep = new Set(Array.from({ length: next }, (_, i) => ingredientSlotName(i + 1)));
  const slots = Object.fromEntries(
    Object.entries(stage.slots).filter(
      ([name]) => !/^ingredients\d*$/.test(name) || keep.has(name),
    ),
  );
  return { ...stage, config: { ...stage.config, [INGREDIENT_COUNT_KEY]: next }, slots };
}

/** The Google accounts a Flow stage uses, in order of use. They are picked
 * from the accounts signed in to BrowserOS Neo, not typed, so they stay out
 * of the Config form too. An empty list clears the setting. */
export function flowAccounts(config: Record<string, unknown>): string[] {
  const accounts = config[ACCOUNTS_KEY];
  return Array.isArray(accounts) ? accounts.filter((a): a is string => typeof a === 'string') : [];
}

export function withFlowAccounts(stage: StageDef, accounts: string[]): StageDef {
  const rest = { ...stage.config };
  delete rest[ACCOUNTS_KEY];
  return { ...stage, config: accounts.length ? { ...rest, [ACCOUNTS_KEY]: accounts } : rest };
}

/** Adds `email` at the end of the list, or removes it when already listed. */
export function toggleAccount(accounts: string[], email: string): string[] {
  return accounts.includes(email) ? accounts.filter((a) => a !== email) : [...accounts, email];
}

export type FlowAccountChoice = { email: string; name: string; signedIn: boolean };

/** Accounts matching a search box (by email or name), case-insensitively. */
export function filterAccounts(accounts: FlowAccountChoice[], query: string): FlowAccountChoice[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return accounts;
  return accounts.filter(
    (a) => a.email.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle),
  );
}

/** Generate Image makes several images from one prompt when its output is an
 * image list. How many, and what to do when fewer come back, are two config
 * values with their own controls under Output, so they stay out of the Config
 * form. Mirrors `MAX_IMAGE_COUNT` in `@reelcraft/shared`, whose runtime values
 * the web app cannot import. */
export const IMAGE_CAPABILITY = 'image.generate';
export const IMAGE_LIST_KIND = 'media.image_list';
const IMAGE_COUNT_KEY = 'count';
const IMAGE_SHORTFALL_KEY = 'onShortfall';
export const MIN_IMAGE_COUNT = 2;
export const MAX_IMAGE_COUNT = 8;
export const DEFAULT_IMAGE_COUNT = 4;
/** An Image output can also make several candidates for quality control to
 * pick the best from. Mirrors `MAX_PICK_IMAGE_COUNT` in `@reelcraft/shared`. */
export const MAX_PICK_IMAGE_COUNT = 4;
export const DEFAULT_PICK_IMAGE_COUNT = 3;

export type ImageShortfall = 'warn' | 'fail';

export const IMAGE_SHORTFALL_OPTIONS: Array<{ value: ImageShortfall; label: string }> = [
  { value: 'warn', label: 'Warn and continue' },
  { value: 'fail', label: 'Fail and retry' },
];

export function imageCount(config: Record<string, unknown>): number {
  const count = config[IMAGE_COUNT_KEY];
  return typeof count === 'number' ? count : DEFAULT_IMAGE_COUNT;
}

export function imageShortfall(config: Record<string, unknown>): ImageShortfall {
  return config[IMAGE_SHORTFALL_KEY] === 'fail' ? 'fail' : 'warn';
}

/** The stage with `count` images, kept within the allowed range. */
export function withImageCount(stage: StageDef, count: number): StageDef {
  const next = Math.min(Math.max(Math.trunc(count), MIN_IMAGE_COUNT), MAX_IMAGE_COUNT);
  return { ...stage, config: { ...stage.config, [IMAGE_COUNT_KEY]: next } };
}

/** How many candidates an Image output makes for quality control to pick from,
 * or `undefined` when it makes just the one image. */
export function pickCount(config: Record<string, unknown>): number | undefined {
  const count = config[IMAGE_COUNT_KEY];
  return typeof count === 'number' && count > 1 ? count : undefined;
}

/** The stage making `count` candidates to pick from (kept within the allowed
 * range), or one image again when `count` is `undefined`. */
export function withPickCount(stage: StageDef, count: number | undefined): StageDef {
  const rest = { ...stage.config };
  delete rest[IMAGE_COUNT_KEY];
  if (count === undefined) {
    delete rest[IMAGE_SHORTFALL_KEY];
    return { ...stage, config: rest };
  }
  const next = Math.min(Math.max(Math.trunc(count), MIN_IMAGE_COUNT), MAX_PICK_IMAGE_COUNT);
  return { ...stage, config: { ...rest, [IMAGE_COUNT_KEY]: next } };
}

/** "Warn and continue" is the default, so it is stored as no value at all. */
export function withImageShortfall(stage: StageDef, mode: ImageShortfall): StageDef {
  const rest = { ...stage.config };
  delete rest[IMAGE_SHORTFALL_KEY];
  return { ...stage, config: mode === 'fail' ? { ...rest, [IMAGE_SHORTFALL_KEY]: mode } : rest };
}

/** The stage with its output switched to `kind`. For Generate Image that also
 * sets up or clears the image-list settings, which only an image list may have. */
export function withOutputKind(stage: StageDef, kind: OutputKind): StageDef {
  const switched: StageDef = { ...stage, output: buildStageOutput(kind, stage.output) };
  if (stage.capability !== IMAGE_CAPABILITY) return switched;
  if (kind === IMAGE_LIST_KIND) {
    return stage.config[IMAGE_COUNT_KEY] === undefined
      ? withImageCount(switched, DEFAULT_IMAGE_COUNT)
      : switched;
  }
  const rest = { ...switched.config };
  delete rest[IMAGE_COUNT_KEY];
  delete rest[IMAGE_SHORTFALL_KEY];
  return { ...switched, config: rest };
}

/** The config schema as the Config form should show it. */
export function visibleConfigSchema(capability: string, schema: JsonSchema): JsonSchema {
  if (!schema.properties) return schema;
  if (capability === IMAGE_CAPABILITY) {
    const properties = { ...schema.properties };
    delete properties[IMAGE_COUNT_KEY];
    delete properties[IMAGE_SHORTFALL_KEY];
    return { ...schema, properties };
  }
  if (capability !== FLOW_CAPABILITY) return schema;
  const properties = { ...schema.properties };
  delete properties[INGREDIENT_COUNT_KEY];
  delete properties[ACCOUNTS_KEY];
  return { ...schema, properties };
}
