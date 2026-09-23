import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type PrimitiveType = 'string' | 'number' | 'boolean';

function primitiveTypeOf(value: unknown): PrimitiveType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/** Shared by `EnabledWhenEditor` (`equals: string | number | boolean`),
 * `BindingPicker`'s `const` case (`value: unknown`), and `ModelPinEditor`'s
 * `ParamsEditor` (`params: Record<string, unknown>`) — each binds a field
 * that can legitimately hold a string, number, or boolean, but a plain
 * `<input type="text">` can only ever write back a string. A type selector
 * plus the matching control lets any of the three be authored correctly
 * without a JSON textarea (Locked Decision 3). Array/object values (e.g. an
 * `iterate.over` const list) are out of scope for this control — switching
 * away from "string" on one of those simply starts from an empty value of
 * the newly selected type. */
export function TypedValueInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string | number | boolean) => void;
}) {
  const type = primitiveTypeOf(value);

  function setType(next: PrimitiveType) {
    if (next === 'number') onChange(typeof value === 'number' ? value : 0);
    else if (next === 'boolean') onChange(typeof value === 'boolean' ? value : false);
    else onChange(typeof value === 'string' ? value : '');
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Select value={type} onValueChange={(next) => setType(next as PrimitiveType)}>
        <SelectTrigger size="sm" className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="string">string</SelectItem>
          <SelectItem value="number">number</SelectItem>
          <SelectItem value="boolean">boolean</SelectItem>
        </SelectContent>
      </Select>
      {type === 'string' && (
        <Input
          type="text"
          className="w-48"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {type === 'number' && (
        <Input
          type="number"
          className="w-32"
          value={typeof value === 'number' ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
      )}
      {type === 'boolean' && (
        <Checkbox
          checked={typeof value === 'boolean' ? value : false}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      )}
    </span>
  );
}
