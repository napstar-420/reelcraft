import { useState } from 'react';
import type { JsonSchema } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { inferSchemaFromValue, retypeSchema } from './stage-inspector.logic';

const SCHEMA_TYPES: JsonSchema['type'][] = [
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
];

function nextFreeKey(existing: Record<string, unknown>): string {
  let n = 1;
  while (existing[`key-${n}`] !== undefined) n++;
  return `key-${n}`;
}

function parseEnumList(raw: string, numeric: boolean): (string | number)[] | undefined {
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => (numeric ? Number(v) : v))
    .filter((v) => !numeric || !Number.isNaN(v as number));
  return values.length > 0 ? values : undefined;
}

function EnumField({
  schema,
  onChange,
}: {
  schema: JsonSchema;
  onChange: (enumValues: (string | number)[] | undefined) => void;
}) {
  const numeric = schema.type === 'number' || schema.type === 'integer';
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Allowed values (comma-separated)</Label>
      <Input
        type="text"
        defaultValue={(schema.enum ?? []).join(', ')}
        onBlur={(e) => onChange(parseEnumList(e.target.value, numeric))}
      />
    </div>
  );
}

function PropertiesEditor({
  schema,
  onChange,
}: {
  schema: JsonSchema;
  onChange: (schema: JsonSchema) => void;
}) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  function updateProperties(nextProperties: Record<string, JsonSchema>, nextRequired: Set<string>) {
    onChange({
      ...schema,
      properties: nextProperties,
      required: [...nextRequired].filter((key) => nextProperties[key] !== undefined),
    });
  }

  function renameKey(oldKey: string, newKey: string) {
    const propSchema = properties[oldKey];
    if (!newKey || oldKey === newKey || properties[newKey] !== undefined || !propSchema) return;
    const nextProperties = { ...properties };
    delete nextProperties[oldKey];
    nextProperties[newKey] = propSchema;
    const nextRequired = new Set(required);
    if (nextRequired.delete(oldKey)) nextRequired.add(newKey);
    updateProperties(nextProperties, nextRequired);
  }

  function updatePropertySchema(key: string, propSchema: JsonSchema) {
    updateProperties({ ...properties, [key]: propSchema }, required);
  }

  function toggleRequired(key: string, isRequired: boolean) {
    const nextRequired = new Set(required);
    if (isRequired) nextRequired.add(key);
    else nextRequired.delete(key);
    updateProperties(properties, nextRequired);
  }

  function removeKey(key: string) {
    const nextProperties = { ...properties };
    delete nextProperties[key];
    const nextRequired = new Set(required);
    nextRequired.delete(key);
    updateProperties(nextProperties, nextRequired);
  }

  function addProperty() {
    updateProperties({ ...properties, [nextFreeKey(properties)]: { type: 'string' } }, required);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Properties</Label>
      {Object.entries(properties).map(([key, propSchema]) => (
        <Card key={key} size="sm">
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="text"
                className="w-40"
                defaultValue={key}
                onBlur={(e) => renameKey(key, e.target.value.trim())}
              />
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Checkbox
                  checked={required.has(key)}
                  onCheckedChange={(checked) => toggleRequired(key, checked === true)}
                />
                Required
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => removeKey(key)}
              >
                Remove
              </Button>
            </div>
            <OutputSchemaEditor
              schema={propSchema}
              onChange={(next) => updatePropertySchema(key, next)}
            />
          </CardContent>
        </Card>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={addProperty}
      >
        + Add property
      </Button>
    </div>
  );
}

function ExtractSchemaDialog({ onExtract }: { onExtract: (schema: JsonSchema) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  function extract() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('That is not valid JSON.');
      return;
    }
    onExtract(inferSchemaFromValue(parsed));
    setOpen(false);
    setText('');
    setError(undefined);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Extract from JSON
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Extract schema from JSON</DialogTitle>
          <DialogDescription>
            Paste a sample object. Its keys and types replace the current schema.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={10}
          className="max-h-87.5 overflow-y-auto font-mono text-xs"
          placeholder={'{\n  "title": "Best topic",\n  "topicId": 18\n}'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(undefined);
          }}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={extract} disabled={text.trim().length === 0}>
            Extract
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A purpose-built editor for authoring `output.schema` itself (as opposed to
 * `SchemaForm`, which builds a form for editing a *value* against a schema).
 * Unlike a self-referential meta-schema through `SchemaForm`, this can
 * recurse into `properties`/`items` and show only the fields relevant to the
 * selected `type`. */
export function OutputSchemaEditor({
  schema,
  onChange,
}: {
  schema: JsonSchema;
  onChange: (schema: JsonSchema) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-l-2 border-border pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={schema.type}
          onValueChange={(next) => onChange(retypeSchema(schema, next as JsonSchema['type']))}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEMA_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {schema.type === 'object' && <ExtractSchemaDialog onExtract={onChange} />}
      </div>

      <Input
        type="text"
        placeholder="Description (optional)"
        defaultValue={schema.description ?? ''}
        onBlur={(e) => onChange({ ...schema, description: e.target.value || undefined })}
      />

      {(schema.type === 'string' || schema.type === 'number' || schema.type === 'integer') && (
        <EnumField
          schema={schema}
          onChange={(enumValues) => onChange({ ...schema, enum: enumValues })}
        />
      )}

      {schema.type === 'string' && (
        <div className="flex gap-2">
          <div className="flex flex-col gap-1.5">
            <Label>Min length</Label>
            <Input
              type="number"
              className="w-28"
              defaultValue={schema.minLength ?? ''}
              onBlur={(e) =>
                onChange({
                  ...schema,
                  minLength: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Max length</Label>
            <Input
              type="number"
              className="w-28"
              defaultValue={schema.maxLength ?? ''}
              onBlur={(e) =>
                onChange({
                  ...schema,
                  maxLength: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </div>
        </div>
      )}

      {(schema.type === 'number' || schema.type === 'integer') && (
        <div className="flex gap-2">
          <div className="flex flex-col gap-1.5">
            <Label>Minimum</Label>
            <Input
              type="number"
              className="w-28"
              defaultValue={schema.minimum ?? ''}
              onBlur={(e) =>
                onChange({
                  ...schema,
                  minimum: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Maximum</Label>
            <Input
              type="number"
              className="w-28"
              defaultValue={schema.maximum ?? ''}
              onBlur={(e) =>
                onChange({
                  ...schema,
                  maximum: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </div>
        </div>
      )}

      {schema.type === 'array' && (
        <>
          <div className="flex gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Min items</Label>
              <Input
                type="number"
                className="w-28"
                defaultValue={schema.minItems ?? ''}
                onBlur={(e) =>
                  onChange({
                    ...schema,
                    minItems: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Max items</Label>
              <Input
                type="number"
                className="w-28"
                defaultValue={schema.maxItems ?? ''}
                onBlur={(e) =>
                  onChange({
                    ...schema,
                    maxItems: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <Label>Item type</Label>
          <OutputSchemaEditor
            schema={schema.items ?? { type: 'string' }}
            onChange={(next) => onChange({ ...schema, items: next })}
          />
        </>
      )}

      {schema.type === 'object' && <PropertiesEditor schema={schema} onChange={onChange} />}
    </div>
  );
}
