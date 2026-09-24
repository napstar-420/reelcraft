import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const UNSET = '__unset__';

/** Shared capability `<Select>` — value `''` means unset. Each option shows
 * its `description` as a tooltip on hover/focus. */
export function CapabilityPicker({
  value,
  onValueChange,
  placeholder = 'Select a capability…',
  size = 'default',
  triggerClassName,
}: {
  value: string;
  onValueChange: (next: string) => void;
  placeholder?: string;
  size?: 'sm' | 'default';
  triggerClassName?: string;
}) {
  const capabilities = useQuery({ queryKey: ['capabilities'], queryFn: api.listCapabilities });

  return (
    <Select
      value={value || UNSET}
      onValueChange={(next) => onValueChange(next === UNSET ? '' : next)}
    >
      <SelectTrigger size={size} className={triggerClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>{placeholder}</SelectItem>
        {capabilities.data?.map((c) => (
          <Tooltip key={c.key}>
            <TooltipTrigger asChild>
              <SelectItem value={c.key}>{c.label}</SelectItem>
            </TooltipTrigger>
            <TooltipContent side="right">{c.description}</TooltipContent>
          </Tooltip>
        ))}
      </SelectContent>
    </Select>
  );
}
