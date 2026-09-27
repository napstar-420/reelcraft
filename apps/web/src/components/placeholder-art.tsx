import type { LucideIcon } from 'lucide-react';
import { Clapperboard } from 'lucide-react';
import { cn } from 'cn';

/** A stable [0, 1) value derived from a string, so a given id always
 * renders the same gradient angle/hue instead of reshuffling on refetch. */
function seededUnit(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

/** Honest placeholder for "nothing has rendered here yet" — a deterministic
 * gradient tile plus an icon, instead of a stock photo that would make an
 * empty blueprint/channel look like it already has content. */
export function PlaceholderArt({
  seed,
  icon: Icon = Clapperboard,
  className,
}: {
  seed: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const t = seededUnit(seed);
  const hueA = 250 + t * 60;
  const hueB = hueA + 40;
  const angle = Math.round(t * 360);

  return (
    <div
      role="img"
      aria-label="No preview available"
      className={cn('flex items-center justify-center overflow-hidden rounded-lg', className)}
      style={{
        background: `linear-gradient(${angle}deg, oklch(0.32 0.09 ${hueA}), oklch(0.22 0.07 ${hueB}))`,
      }}
    >
      <Icon className="size-[35%] text-white/70" strokeWidth={1.5} />
    </div>
  );
}
