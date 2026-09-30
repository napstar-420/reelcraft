import { useId } from 'react';
import { Input } from '@/components/ui/input';
import type { PathSuggestion } from '../../lib/ref-paths';

/** A `Ref.path` / memory-write path box with native `<datalist>` suggestions.
 * `suggestions === null` means the source has no fields to path into, so an
 * empty box is disabled; `undefined` (source not known yet) is free text. */
export function PathInput({
  value,
  onChange,
  suggestions,
  placeholder = 'path (optional)',
}: {
  value: string | undefined;
  onChange: (path: string | undefined) => void;
  suggestions: PathSuggestion[] | null | undefined;
  placeholder?: string;
}) {
  const listId = useId();
  const noFields = suggestions === null && !value;
  return (
    <>
      <Input
        type="text"
        className="w-40 font-mono"
        list={suggestions ? listId : undefined}
        placeholder={noFields ? 'no fields to path into' : placeholder}
        disabled={noFields}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s.path} value={s.path} label={s.type} />
          ))}
        </datalist>
      )}
    </>
  );
}
