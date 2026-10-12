import { useLayoutEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { TimelineStyle } from '@reelcraft/shared';
import { CaptionWords } from '@reelcraft/timeline-composition';
import { resolveCaptionLook } from '@reelcraft/timeline-composition/src/render-helpers';
import { cn } from 'cn';

/** What every miniature says, so the templates can be compared side by side. */
const SAMPLE = ['Wow', 'look'];
const SPOKEN = 1;
/** How big the sample text is drawn in every card, so a 48 px template and an 84 px one can be
 * compared at a glance. Everything else about a look (outline, shadow, box) scales with it. */
const SAMPLE_TEXT_PX = 15;
const CARD_HEIGHT = 84;

function Miniature({ template }: { template: TimelineStyle }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(132);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(() => setWidth(card.clientWidth));
    observer.observe(card);
    setWidth(card.clientWidth);
    return () => observer.disconnect();
  }, []);
  const tokens = template.tokens;
  if (!tokens) return null;
  const look = resolveCaptionLook(tokens, undefined);
  // The template is laid out at its own size and the whole thing is scaled to the sample size, so
  // its proportions (and every pixel value in it) stay true.
  const scale = SAMPLE_TEXT_PX / tokens.fontSize;
  const center = look.position === 'center';
  const left = look.tokens.align === 'left';
  return (
    <div
      ref={cardRef}
      className="relative w-full overflow-hidden rounded-md bg-gradient-to-br from-[#2b2540] via-[#3c2f3a] to-[#51382f]"
      style={{ height: CARD_HEIGHT }}
    >
      <div
        className="absolute top-0 left-0 flex origin-top-left flex-col"
        style={{
          width: width / scale,
          height: CARD_HEIGHT / scale,
          padding: `0 ${10 / scale}px ${10 / scale}px`,
          transform: `scale(${scale})`,
          justifyContent: center ? 'center' : 'flex-end',
          alignItems: left ? 'flex-start' : 'center',
          textAlign: left ? 'left' : 'center',
        }}
      >
        <div>
          <CaptionWords words={SAMPLE} activeIndex={SPOKEN} look={look} />
        </div>
      </div>
    </div>
  );
}

/** The caption templates, each as a small live example. Choosing one gives the captions that whole
 * look: how the text is drawn, how the spoken word stands out, how many words show and where. */
export function CaptionTemplatePicker({
  templates,
  value,
  disabled,
  onChange,
}: {
  templates: TimelineStyle[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Caption template">
      {templates.map((template) => {
        const selected = template.id === value;
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={template.label}
            title={template.description}
            disabled={disabled}
            onClick={() => onChange(template.id)}
            className={cn(
              'group relative overflow-hidden rounded-lg border bg-card text-left transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60',
              selected
                ? 'border-primary ring-2 ring-primary/60'
                : 'border-border hover:border-primary/50',
            )}
          >
            <Miniature template={template} />
            <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-xs font-medium">
              <span className="truncate">{template.label}</span>
              {selected ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
