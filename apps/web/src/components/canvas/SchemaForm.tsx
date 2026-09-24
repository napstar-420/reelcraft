import type { JsonSchema } from '@reefcraft/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

const ENUM_UNSET = '__unset__';

function EnumSelect({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const selected = value === undefined || value === null ? ENUM_UNSET : String(value);
  return (
    <Select
      value={selected}
      onValueChange={(next) =>
        onChange(next === ENUM_UNSET ? undefined : coerceEnumValue(schema, next))
      }
    >
      <SelectTrigger size="sm" className="w-full">
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ENUM_UNSET}>Select…</SelectItem>
        {(schema.enum ?? []).map((option) => (
          <SelectItem key={String(option)} value={String(option)}>
            {String(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RequiredMark() {
  return <span className="text-destructive"> *</span>;
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
    <div className="flex flex-col gap-3 border-l-2 border-border pl-3">
      {schema.description && <p className="text-sm text-muted-foreground">{schema.description}</p>}
      {Object.entries(properties).map(([propKey, propSchema]) => (
        <div key={propKey} className="flex flex-col gap-1.5">
          <Label>
            {propKey}
            {required.has(propKey) && <RequiredMark />}
          </Label>
          <SchemaForm
            schema={propSchema}
            value={obj[propKey]}
            onChange={(next) => onChange({ ...obj, [propKey]: next })}
          />
        </div>
      ))}
    </div>
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
    <div className="flex flex-col gap-3 border-l-2 border-border pl-3">
      {schema.description && <p className="text-sm text-muted-foreground">{schema.description}</p>}
      {items.map((item, index) => (
        <Card key={index} size="sm">
          <CardContent className="flex flex-col gap-2">
            <SchemaForm
              schema={itemSchema}
              value={item}
              onChange={(next) => {
                const copy = [...items];
                copy[index] = next;
                onChange(copy);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canRemove}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              className="self-start"
            >
              Remove item
            </Button>
          </CardContent>
        </Card>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canAdd}
        onClick={() => onChange([...items, defaultForSchema(itemSchema)])}
        className="self-start"
      >
        + Add item
      </Button>
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
        <Input
          type="text"
          className="w-full"
          value={typeof value === 'string' ? value : ''}
          minLength={schema.minLength}
          maxLength={schema.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
    case 'integer':
      return (
        <Input
          type="number"
          className="w-full"
          value={typeof value === 'number' ? value : ''}
          min={schema.minimum}
          max={schema.maximum}
          step={schema.type === 'integer' ? 1 : undefined}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'boolean':
      return (
        <Checkbox checked={!!value} onCheckedChange={(checked) => onChange(checked === true)} />
      );
    case 'object':
      return <ObjectForm schema={schema} value={value} onChange={onChange} />;
    case 'array':
      return <ArrayForm schema={schema} value={value} onChange={onChange} />;
  }
}
