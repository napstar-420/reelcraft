import type { ReactNode } from 'react';
import { InfoIcon } from 'lucide-react';
import { SECTION_HEADING_CLASS } from './typography';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** A `SECTION_HEADING_CLASS` heading with an info icon whose tooltip carries
 * a longer explanation of what the section below it does — for sub-sections
 * whose name alone doesn't convey their purpose (e.g. "Output", "Quality
 * control"). */
export function InfoHeading({ children, info }: { children: ReactNode; info: string }) {
  return (
    <h3 className={`${SECTION_HEADING_CLASS} flex items-center gap-1.5`}>
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <InfoIcon className="size-3.5 cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-64 text-left normal-case">
          {info}
        </TooltipContent>
      </Tooltip>
    </h3>
  );
}

/** Like `InfoHeading` but sized/styled for a field `Label` rather than a
 * section heading — for individual inputs whose own name doesn't convey
 * their syntax, scope, or effect (e.g. "Key", "Template", "Threshold"). */
export function InfoLabel({ children, info }: { children: ReactNode; info: string }) {
  return (
    <Label className="flex items-center gap-1.5">
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <InfoIcon className="size-3.5 cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-64 text-left normal-case">
          {info}
        </TooltipContent>
      </Tooltip>
    </Label>
  );
}
