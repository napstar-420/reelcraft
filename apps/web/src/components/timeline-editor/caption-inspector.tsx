import { useState, type RefObject } from 'react';
import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Merge,
  RotateCcw,
  Split,
  Trash2,
} from 'lucide-react';
import type { PlayerRef } from '@remotion/player';
import type {
  CaptionStyleOverrides,
  TimelineItem,
  TimelineStyle,
  TimingMap,
} from '@reelcraft/shared';
import { CAPTION_HIGHLIGHT } from '@reelcraft/timeline-composition/src/render-helpers';
import {
  captionPagesFor,
  DEFAULT_WORDS_PER_PAGE,
  type CaptionPage,
} from '@reelcraft/timeline-composition/src/captions';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  mergeWithNext,
  pageText,
  removePage,
  setPageText,
  splitPage,
  toStoredPages,
} from '@/pages/timeline-editor/caption-edit';
import { formatTimecode } from '@/pages/timeline-editor/format-time';
import { usePlayerFrame } from './use-player';

type Captions = Extract<TimelineItem, { type: 'captions' }>;
type Position = NonNullable<CaptionStyleOverrides['position']>;

const POSITIONS: Array<{ value: Position; label: string; Icon: typeof AlignVerticalJustifyEnd }> = [
  { value: 'top', label: 'Top', Icon: AlignVerticalJustifyStart },
  { value: 'center', label: 'Middle', Icon: AlignVerticalJustifyCenter },
  { value: 'bottom', label: 'Bottom', Icon: AlignVerticalJustifyEnd },
];

const hexOr = (value: string | undefined, fallback: string) =>
  value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <label className="flex h-8 items-center gap-2 rounded-lg border bg-input/30 px-2">
        <input
          type="color"
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <span className="font-mono text-xs text-muted-foreground uppercase">{value}</span>
      </label>
    </div>
  );
}

function PageRow({
  page,
  index,
  active,
  isLast,
  readOnly,
  fps,
  onSeek,
  onText,
  onSplit,
  onMerge,
  onRemove,
}: {
  page: CaptionPage;
  index: number;
  active: boolean;
  isLast: boolean;
  readOnly: boolean;
  fps: number;
  onSeek: () => void;
  onText: (text: string) => void;
  onSplit: () => void;
  onMerge: () => void;
  onRemove: () => void;
}) {
  const text = pageText(page);
  const [draft, setDraft] = useState(text);
  const commit = () => {
    if (draft.trim() && draft.trim() !== text) onText(draft);
    else setDraft(text);
  };
  return (
    <li
      className={cn(
        'group rounded-lg border bg-muted/30 p-2 transition-colors',
        active && 'border-primary/60 bg-primary/10',
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSeek}
          className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums hover:text-foreground"
          title="Go to this page"
        >
          {formatTimecode(page.startSec, fps)}
        </button>
        <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Split page"
            title="Split page"
            disabled={readOnly || page.words.length < 2}
            onClick={onSplit}
          >
            <Split />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Merge with next page"
            title="Merge with next page"
            disabled={readOnly || isLast}
            onClick={onMerge}
          >
            <Merge />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Delete page"
            title="Delete page"
            disabled={readOnly}
            onClick={onRemove}
            className="hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <Input
        aria-label={`Caption page ${index + 1}`}
        value={draft}
        disabled={readOnly}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          if (event.key === 'Escape') setDraft(text);
        }}
        className="h-8"
      />
    </li>
  );
}

function Transcript({
  item,
  timing,
  readOnly,
  playerRef,
  fps,
  onSeekSec,
  update,
}: {
  item: Captions;
  timing: TimingMap;
  readOnly: boolean;
  playerRef: RefObject<PlayerRef>;
  fps: number;
  onSeekSec: (sec: number) => void;
  update: (mutate: (item: TimelineItem) => void) => void;
}) {
  const frame = usePlayerFrame(playerRef);
  // Word times are on the timeline's own clock, the same one the player reports.
  const second = frame / fps;
  const pages = captionPagesFor(item, timing.words);
  const activeIndex = pages.findIndex(
    (page) => second >= page.startSec && second < page.endSec + 0.4,
  );
  const apply = (next: CaptionPage[] | undefined) => {
    if (!next) return;
    update((draft) => {
      if (draft.type === 'captions') draft.pages = toStoredPages(next);
    });
  };
  return (
    <ul className="space-y-1.5">
      {pages.map((page, index) => (
        <PageRow
          key={`${index}-${pageText(page)}-${page.startSec}`}
          page={page}
          index={index}
          active={index === activeIndex}
          isLast={index === pages.length - 1}
          readOnly={readOnly}
          fps={fps}
          onSeek={() => onSeekSec(page.startSec)}
          onText={(text) => apply(setPageText(pages, index, text))}
          onSplit={() => apply(splitPage(pages, index))}
          onMerge={() => apply(mergeWithNext(pages, index))}
          onRemove={() => apply(removePage(pages, index))}
        />
      ))}
    </ul>
  );
}

/** Edits a captions item: its preset, how it looks, and the words on each page. */
export function CaptionInspector({
  item,
  styles,
  timing,
  readOnly,
  playerRef,
  fps,
  onSeekSec,
  update,
}: {
  item: Captions;
  styles: TimelineStyle[];
  timing: TimingMap | undefined;
  readOnly: boolean;
  playerRef: RefObject<PlayerRef>;
  fps: number;
  onSeekSec: (sec: number) => void;
  update: (mutate: (item: TimelineItem) => void) => void;
}) {
  const presets = styles.filter((style) => style.supportedItemTypes.includes('captions'));
  const tokens = styles.find((style) => style.id === item.styleId)?.tokens;
  const look = item.style ?? {};
  const edited = !!item.pages?.length;

  const setLook = (patch: Partial<Record<keyof CaptionStyleOverrides, unknown>>) =>
    update((draft) => {
      if (draft.type !== 'captions') return;
      const next: Record<string, unknown> = { ...draft.style, ...patch };
      for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
      if (Object.keys(next).length) draft.style = next as CaptionStyleOverrides;
      else delete draft.style;
    });

  return (
    <div className="space-y-6">
      <Section title="Style">
        <Select
          value={item.styleId}
          disabled={readOnly}
          onValueChange={(styleId) =>
            update((draft) => {
              if (draft.type === 'captions') draft.styleId = styleId;
            })
          }
        >
          <SelectTrigger size="sm" className="w-full" aria-label="Caption style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((style) => (
              <SelectItem key={style.id} value={style.id}>
                {style.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <Section
        title="Look"
        action={
          item.style ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={readOnly}
              onClick={() =>
                update((draft) => {
                  if (draft.type === 'captions') delete draft.style;
                })
              }
            >
              <RotateCcw /> Reset
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-1.5">
          <Label>Position</Label>
          <div
            className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/30 p-1"
            role="radiogroup"
            aria-label="Position"
          >
            {POSITIONS.map(({ value, label, Icon }) => {
              const selected = (look.position ?? 'bottom') === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={readOnly}
                  onClick={() => setLook({ position: value === 'bottom' ? undefined : value })}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50',
                    selected && 'bg-background text-foreground shadow-sm',
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ColorField
            label="Text colour"
            value={hexOr(look.color ?? tokens?.color, '#ffffff')}
            disabled={readOnly}
            onChange={(color) => setLook({ color })}
          />
          <ColorField
            label="Highlight"
            value={hexOr(look.highlightColor, CAPTION_HIGHLIGHT)}
            disabled={readOnly}
            onChange={(highlightColor) => setLook({ highlightColor })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Size ({look.fontSize ?? tokens?.fontSize ?? 64}px)</Label>
          <Slider
            aria-label="Caption size"
            min={24}
            max={140}
            step={2}
            disabled={readOnly}
            value={[look.fontSize ?? tokens?.fontSize ?? 64]}
            onValueChange={([value]) => value !== undefined && setLook({ fontSize: value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Words per page ({look.wordsPerPage ?? DEFAULT_WORDS_PER_PAGE})</Label>
          <Slider
            aria-label="Words per page"
            min={1}
            max={6}
            step={1}
            disabled={readOnly || edited}
            value={[look.wordsPerPage ?? DEFAULT_WORDS_PER_PAGE]}
            onValueChange={([value]) => value !== undefined && setLook({ wordsPerPage: value })}
          />
          {edited ? (
            <p className="text-xs text-muted-foreground">
              The pages below are edited. Reset them to page by this number again.
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="caption-uppercase">Uppercase</Label>
          <Switch
            id="caption-uppercase"
            size="sm"
            disabled={readOnly}
            checked={look.uppercase ?? tokens?.uppercase ?? false}
            onCheckedChange={(uppercase) => setLook({ uppercase })}
          />
        </div>
      </Section>

      <Section
        title="Transcript"
        action={
          edited ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={readOnly}
              onClick={() =>
                update((draft) => {
                  if (draft.type === 'captions') delete draft.pages;
                })
              }
            >
              <RotateCcw /> Reset to transcript
            </Button>
          ) : undefined
        }
      >
        {timing ? (
          <Transcript
            item={item}
            timing={timing}
            readOnly={readOnly}
            playerRef={playerRef}
            fps={fps}
            onSeekSec={onSeekSec}
            update={update}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            This stage has no word timings for these captions, so there is nothing to edit here.
          </p>
        )}
      </Section>
    </div>
  );
}
