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
    <span>
      <select value={type} onChange={(e) => setType(e.target.value as PrimitiveType)}>
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="boolean">boolean</option>
      </select>
      {type === 'string' && (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {type === 'number' && (
        <input
          type="number"
          value={typeof value === 'number' ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
      )}
      {type === 'boolean' && (
        <input
          type="checkbox"
          checked={typeof value === 'boolean' ? value : false}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
    </span>
  );
}
