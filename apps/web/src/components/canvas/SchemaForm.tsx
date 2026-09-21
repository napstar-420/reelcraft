import type { JsonSchema } from '@reefcraft/shared';

function defaultForSchema(schema: JsonSchema): unknown {
  switch (schema.type) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'object':
      return {};
    case 'array':
      return [];
  }
}

function coerceEnumValue(schema: JsonSchema, raw: string): string | number {
  return typeof schema.enum?.[0] === 'number' ? Number(raw) : raw;
}

function EnumSelect({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <select
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(e) => onChange(coerceEnumValue(schema, e.target.value))}
    >
      <option value="">Select…</option>
      {(schema.enum ?? []).map((option) => (
        <option key={String(option)} value={String(option)}>
          {String(option)}
        </option>
      ))}
    </select>
  );
}

function ObjectForm({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const obj = (
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
  ) as Record<string, unknown>;
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  return (
    <fieldset>
      {schema.description && <p>{schema.description}</p>}
      {Object.entries(properties).map(([propKey, propSchema]) => (
        <div key={propKey}>
          <label>
            {propKey}
            {required.has(propKey) ? ' *' : ''}
          </label>
          <SchemaForm
            schema={propSchema}
            value={obj[propKey]}
            onChange={(next) => onChange({ ...obj, [propKey]: next })}
          />
        </div>
      ))}
    </fieldset>
  );
}

function ArrayForm({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const items = Array.isArray(value) ? value : [];
  const itemSchema = schema.items ?? { type: 'string' };
  const canAdd = schema.maxItems === undefined || items.length < schema.maxItems;
  const canRemove = schema.minItems === undefined || items.length > schema.minItems;

  return (
    <div>
      {schema.description && <p>{schema.description}</p>}
      {items.map((item, index) => (
        <div key={index}>
          <SchemaForm
            schema={itemSchema}
            value={item}
            onChange={(next) => {
              const copy = [...items];
              copy[index] = next;
              onChange(copy);
            }}
          />
          <button
            type="button"
            disabled={!canRemove}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            Remove item
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => onChange([...items, defaultForSchema(itemSchema)])}
      >
        + Add item
      </button>
    </div>
  );
}

/** Chunk 4 — the no-code replacement for a JSON textarea anywhere the
 * restricted `JsonSchema` dialect (§4.2, no `$ref`/`oneOf`/`patternProperties`)
 * describes a value: capability `config`, and (Chunk 4's own addition)
 * `output.schema`. Purely recursive on `schema.type`; `enum` short-circuits
 * to a `<select>` for `string`/`number`/`integer` only, per the dialect's own
 * shape (an enum on `object`/`array`/`boolean` is not a case this dialect
 * produces). */
export function SchemaForm({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (
    schema.enum &&
    (schema.type === 'string' || schema.type === 'number' || schema.type === 'integer')
  ) {
    return <EnumSelect schema={schema} value={value} onChange={onChange} />;
  }

  switch (schema.type) {
    case 'string':
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          minLength={schema.minLength}
          maxLength={schema.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
    case 'integer':
      return (
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={schema.minimum}
          max={schema.maximum}
          step={schema.type === 'integer' ? 1 : undefined}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'boolean':
      return (
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      );
    case 'object':
      return <ObjectForm schema={schema} value={value} onChange={onChange} />;
    case 'array':
      return <ArrayForm schema={schema} value={value} onChange={onChange} />;
  }
}
