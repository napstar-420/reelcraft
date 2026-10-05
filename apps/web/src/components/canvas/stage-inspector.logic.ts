import type { JsonSchema, OutputDef, OutputKind, StageDef } from '@reelcraft/shared';
import type { ParsedValidationPath } from '../../lib/parse-validation-path';

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
  const { [ACCOUNTS_KEY]: _dropped, ...rest } = stage.config;
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

/** The config schema as the Config form should show it. */
export function visibleConfigSchema(capability: string, schema: JsonSchema): JsonSchema {
  if (capability !== FLOW_CAPABILITY || !schema.properties) return schema;
  const properties = { ...schema.properties };
  delete properties[INGREDIENT_COUNT_KEY];
  delete properties[ACCOUNTS_KEY];
  return { ...schema, properties };
}
