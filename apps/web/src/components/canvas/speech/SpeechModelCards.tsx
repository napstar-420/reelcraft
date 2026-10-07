import { CheckCircle2Icon } from 'lucide-react';
import type { ModelInfoDto } from '@reelcraft/shared';
import { Badge } from '@/components/ui/badge';
import { speechOptionsOf } from './speech-settings.logic';

/** The speech models of a provider as a list of cards, each saying what it is for. */
export function SpeechModelCards({
  models,
  selected,
  onSelect,
}: {
  models: ModelInfoDto[];
  selected: string | undefined;
  onSelect: (model: ModelInfoDto) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Model" className="flex flex-col gap-2">
      {models.map((model) => {
        const options = speechOptionsOf(model);
        const on = model.modelId === selected;
        return (
          <button
            key={model.modelId}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(model)}
            className={`flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
              on ? 'border-primary bg-muted/40' : ''
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {model.label}
              {options?.badges?.map((badge) => (
                <Badge key={badge} variant="outline">
                  {badge}
                </Badge>
              ))}
              {on && <CheckCircle2Icon className="ml-auto size-4 shrink-0" />}
            </span>
            {options && (
              <>
                <span className="text-xs text-muted-foreground">{options.summary}</span>
                <span className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  <span>{options.languages}</span>
                  <span aria-hidden>·</span>
                  <span>up to {options.maxChars.toLocaleString()} characters a request</span>
                  {options.audioTags && (
                    <>
                      <span aria-hidden>·</span>
                      <span>audio tags</span>
                    </>
                  )}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
