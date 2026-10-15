import { Timeline } from '@reelcraft/shared';
import type {
  SceneDef,
  SceneSlot,
  SceneSpec,
  TimelineItem,
  TimelineTheme,
  TimingMap,
  VectorAsset,
} from '@reelcraft/shared';
import type { WhiteboardAssetRegistry } from './asset.registry';
import {
  DEFAULT_HEADINGS,
  fitText,
  layoutScene,
  type Connector,
  type FittedText,
  type Rect,
  type SceneLayout,
  type Size,
} from './scene-layout';
import { placeSfx } from './scene-sfx';
import { alignScenes, findCue, spokenWords, type SceneRange } from './scene-timing';

export type SketchItem = Extract<TimelineItem, { type: 'sketch' }>;

export interface CompileWarning {
  code:
    | 'asset_fallback'
    | 'asset_missing'
    | 'cue_unresolved'
    | 'text_overflow'
    | 'captions_skipped'
    | 'timing_missing';
  message: string;
  scene?: string;
  slot?: string;
}

export interface CompileInput {
  spec: SceneSpec;
  canvas: { width: number; height: number; fps: number };
  theme: TimelineTheme;
  /** The voice-over's word timings, if there are any. */
  timing?: TimingMap | undefined;
  /** The voice-over audio, and how long it is. */
  voice?: { handle: string; durationSec?: number | undefined } | undefined;
  /** Captions to show under the drawings, from timings that have a handle. */
  captions?: { handle: string; styleId: string } | undefined;
  /** Drawings this run made, by id. */
  assets: ReadonlyMap<string, VectorAsset>;
  registry: WhiteboardAssetRegistry;
  hand: 'none' | 'marker' | 'pencil';
  /** Add built-in sound effects for drawings and camera moves. */
  sfx?: boolean | undefined;
  /** Background music, quiet under the voice-over. */
  music?:
    { handle: string; durationSec?: number | undefined; volume?: number | undefined } | undefined;
}

export interface CompileResult {
  timeline: Timeline;
  warnings: CompileWarning[];
  scenes: Array<{ id: string; startSec: number; endSec: number }>;
}

/** A plan that can't be made into a video, with a stable code. */
export class SceneCompileError extends Error {
  constructor(
    readonly code: 'scene_world_too_large' | 'scene_timeline_invalid',
    message: string,
  ) {
    super(message);
  }
}

const MAX_WORLD = 20_000;
/** How long the video lingers on the finished drawing after the voice-over ends. */
const TAIL_SEC = 0.8;

const round = (value: number) => Math.round(value * 100) / 100;

/** Turns a scene plan into a timeline: it works out where and when everything goes. */
export function compileScenes(input: CompileInput): CompileResult {
  const { spec, canvas } = input;
  const size: Size = { width: canvas.width, height: canvas.height };
  const landscape = size.width >= size.height;
  const warnings: CompileWarning[] = [];

  const words = spokenWords(input.timing);
  const totalVoice = input.voice?.durationSec ?? input.timing?.durationSec;
  const ranges = alignScenes(
    spec.scenes.map((scene) => scene.narration),
    words,
    totalVoice,
  );
  const endAll = round(Math.max(totalVoice ?? 0, ranges[ranges.length - 1]!.endSec) + TAIL_SEC);

  // The scenes sit in a grid on one big canvas, and the camera moves from one to the next.
  const n = spec.scenes.length;
  const cols = landscape ? Math.min(n, 3) : n <= 6 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const gapX = Math.round(size.width * 0.12);
  const gapY = Math.round(size.height * 0.12);
  const world = {
    width: cols * size.width + (cols - 1) * gapX,
    height: rows * size.height + (rows - 1) * gapY,
  };
  if (world.width > MAX_WORLD || world.height > MAX_WORLD) {
    throw new SceneCompileError(
      'scene_world_too_large',
      `${n} scenes don't fit on one canvas at this size; use fewer scenes or a smaller frame`,
    );
  }
  const origin = (index: number) => ({
    x: (index % cols) * (size.width + gapX),
    y: Math.floor(index / cols) * (size.height + gapY),
  });

  const items: SketchItem[] = [];
  spec.scenes.forEach((scene, index) => {
    const built = buildScene({
      scene,
      range: ranges[index]!,
      origin: origin(index),
      size,
      endAll,
      words,
      input,
      warnings,
    });
    items.push(...built);
  });

  const keys: NonNullable<Timeline['camera']>['keys'] = [];
  spec.scenes.forEach((scene, index) => {
    const range = ranges[index]!;
    const o = origin(index);
    const view =
      scene.camera === 'wide'
        ? {
            cx: world.width / 2,
            cy: world.height / 2,
            zoom: Math.min(size.width / world.width, size.height / world.height) * 0.95,
          }
        : { cx: o.x + size.width / 2, cy: o.y + size.height / 2, zoom: 1 };
    if (index > 0) {
      const previous = keys[keys.length - 1]!;
      const travel = Math.min(0.9, (range.startSec - ranges[index - 1]!.startSec) * 0.4);
      const holdAt = round(range.startSec - travel);
      if (holdAt > previous.atSec) keys.push({ ...previous, atSec: holdAt });
      keys.push({
        atSec: round(Math.max(range.startSec, previous.atSec)),
        ...roundView(view),
        ease: 'in_out',
      });
    } else {
      keys.push({ atSec: 0, ...roundView(view) });
    }
  });

  const tracks: Timeline['tracks'] = [];
  if (input.voice) {
    tracks.push({
      id: 'voice',
      type: 'audio',
      items: [
        {
          type: 'media',
          handle: input.voice.handle,
          startSec: 0,
          durationSec: round(input.voice.durationSec ?? endAll - TAIL_SEC),
        },
      ],
    });
  }
  if (input.music) tracks.push(musicTrack(input.music, endAll, !!input.voice));
  if (input.sfx) {
    const sounds = placeSfx(items, { keys });
    if (sounds.length) tracks.push({ id: 'sfx', type: 'audio', items: sounds });
  }
  tracks.push({ id: 'drawings', type: 'overlay', items });
  if (input.captions) {
    tracks.push({
      id: 'captions',
      type: 'captions',
      items: [
        {
          type: 'captions',
          timingHandle: input.captions.handle,
          styleId: input.captions.styleId,
          startSec: 0,
        },
      ],
    });
  }

  const parsed = Timeline.safeParse({
    version: 2,
    canvas: { width: canvas.width, height: canvas.height, fps: canvas.fps },
    world,
    camera: { keys },
    theme: input.theme,
    tracks,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new SceneCompileError(
      'scene_timeline_invalid',
      `the compiled timeline is not valid: ${first?.path.join('.')} ${first?.message}`,
    );
  }
  return {
    timeline: parsed.data,
    warnings,
    scenes: spec.scenes.map((scene, index) => ({
      id: scene.id,
      startSec: round(ranges[index]!.startSec),
      endSec: round(ranges[index]!.endSec),
    })),
  };
}

/** Background music for the whole video: repeated if it is shorter, faded out at the end, and
 * turned down under the voice-over. */
function musicTrack(
  music: NonNullable<CompileInput['music']>,
  endSec: number,
  hasVoice: boolean,
): Timeline['tracks'][number] {
  const volume = music.volume ?? MUSIC_VOLUME;
  const length = music.durationSec && music.durationSec > 0.5 ? music.durationSec : undefined;
  const items: TimelineItem[] = [];
  if (!length) {
    items.push({
      type: 'media',
      handle: music.handle,
      startSec: 0,
      durationSec: round(endSec),
      volume,
      fadeOutSec: 1.5,
    });
  } else {
    for (let at = 0; at < endSec - 0.05 && items.length < MAX_MUSIC_REPEATS; at += length) {
      const last = at + length >= endSec - 0.05;
      items.push({
        type: 'media',
        handle: music.handle,
        startSec: round(at),
        durationSec: round(Math.min(length, endSec - at)),
        volume,
        ...(last && { fadeOutSec: Math.min(1.5, round(endSec - at)) }),
      });
    }
  }
  return { id: 'music', type: 'audio', ...(hasVoice && { duckUnder: 'voice' }), items };
}

const MUSIC_VOLUME = 0.15;
const MAX_MUSIC_REPEATS = 40;

const roundView = (view: { cx: number; cy: number; zoom: number }) => ({
  cx: Math.round(view.cx),
  cy: Math.round(view.cy),
  zoom: Math.round(view.zoom * 10_000) / 10_000,
});

/* ---------------------------------------------------------------- one scene */

interface SceneContext {
  scene: SceneDef;
  range: SceneRange;
  origin: { x: number; y: number };
  size: Size;
  endAll: number;
  words: ReturnType<typeof spokenWords>;
  input: CompileInput;
  warnings: CompileWarning[];
}

function buildScene(ctx: SceneContext): SketchItem[] {
  const { scene, range, size, input } = ctx;
  const layout = layoutScene(scene.template, scene.slots, scene.title !== undefined, size);
  const items: SketchItem[] = [];
  const unit = Math.min(size.width, size.height);
  const hand = input.hand;

  const add = (
    item: Omit<SketchItem, 'type' | 'durationSec' | 'x' | 'y'> & {
      x: number;
      y: number;
      startSec: number;
    },
  ) => {
    const startSec = round(Math.min(item.startSec, ctx.endAll - 0.5));
    items.push({
      type: 'sketch',
      ...item,
      startSec,
      x: round(ctx.origin.x + item.x),
      y: round(ctx.origin.y + item.y),
      durationSec: round(Math.max(0.5, ctx.endAll - startSec)),
    });
  };

  // The scene's title: big words, written out first.
  let cursor = range.startSec + 0.2;
  if (scene.title && layout.title) {
    const maxSize = scene.template === 'title' ? unit * 0.2 : unit * 0.085;
    const fit = fitText(scene.title, layout.title, maxSize);
    overflowWarning(ctx, fit, scene.title);
    const writeSec = Math.max(0.6, scene.title.length * 0.06);
    add({
      id: `${scene.id}:title`,
      startSec: cursor,
      ...place(layout.title),
      content: {
        kind: 'text',
        text: fit.text,
        size: fit.size,
        color: 'ink',
        font: 'hand',
        align: 'center',
      },
      anim: { type: 'handwrite', ...(hand !== 'none' && { hand }) },
    });
    if (layout.underline) {
      add({
        id: `${scene.id}:underline`,
        startSec: cursor + writeSec,
        ...place(layout.underline),
        content: { kind: 'shape', shape: 'underline', color: 'accent3' },
        anim: { type: 'draw', durationSec: 0.7 },
      });
    }
    cursor += writeSec + 0.3;
  }

  const bySlot = new Map(scene.slots.map((slot) => [slot.slot, slot]));
  const placed = layout.slots.filter((slot) => bySlot.has(slot.name));
  const span = Math.max(0.6 * (range.endSec - range.startSec), 0.5);
  const startOf = (slot: SceneSlot, order: number): number => {
    if (slot.cue) {
      const found = findCue(slot.cue, ctx.words, range);
      if (found !== undefined) return Math.max(range.startSec, found - 0.15);
      ctx.warnings.push({
        code: 'cue_unresolved',
        scene: scene.id,
        slot: slot.slot,
        message: `could not find "${slot.cue}" in the narration of scene "${scene.id}"; placed by order instead`,
      });
    }
    return Math.max(cursor, range.startSec + 0.4 + (span * order) / Math.max(1, placed.length));
  };

  placed.forEach((slotLayout, order) => {
    const slot = bySlot.get(slotLayout.name)!;
    const t = startOf(slot, order);
    const accent = `accent${(order % 3) + 1}`;
    const centered = layout.landscape;

    const headingText = slot.heading ?? DEFAULT_HEADINGS[scene.template]?.[slot.slot];
    if (headingText && slotLayout.heading) {
      const fit = fitText(headingText, slotLayout.heading, unit * 0.055);
      add({
        id: `${scene.id}:${slot.slot}:heading`,
        startSec: t,
        ...place(slotLayout.heading),
        content: {
          kind: 'text',
          text: fit.text,
          size: fit.size,
          color: accent,
          font: 'hand',
          align: centered ? 'center' : 'left',
        },
        anim: { type: 'pop', durationSec: 0.35 },
      });
    }

    const connector = connectorBefore(layout, scene.template, slot.slot, order);
    if (connector) {
      add({
        id: `${scene.id}:${slot.slot}:connector`,
        startSec: Math.max(range.startSec, t - 0.25),
        ...placeConnector(connector),
        ...(connector.vertical && { rotate: 90 }),
        content: { kind: 'shape', shape: 'arrow', color: 'ink' },
        anim: { type: 'draw', durationSec: 0.6 },
      });
    }

    let drawEnd = t + 0.1;
    if (slot.asset && slotLayout.asset) {
      const asset = resolveAsset(ctx, slot);
      const drawSec = Math.min(1.8, Math.max(0.8, 0.5 + asset.strokes.length * 0.12));
      add({
        id: `${scene.id}:${slot.slot}:asset`,
        startSec: t + 0.1,
        ...place(slotLayout.asset),
        content: { kind: 'paths', viewBox: asset.viewBox, strokes: asset.strokes },
        anim: { type: 'draw', durationSec: round(drawSec), ...(hand !== 'none' && { hand }) },
      });
      drawEnd = t + 0.1 + drawSec;
    }

    if (slot.text && slotLayout.label) {
      const maxSize =
        scene.template === 'title' ? unit * 0.075 : unit * (layout.landscape ? 0.075 : 0.07);
      const fit = fitText(slot.text, slotLayout.label, maxSize);
      overflowWarning(ctx, fit, slot.text, slot.slot);
      const labelStart = slot.asset ? Math.max(t + 0.5, drawEnd - 0.4) : t + 0.1;
      const writeSec = Math.max(0.6, slot.text.length * 0.06);
      const text = textBox(slotLayout.label, fit, centered);
      if (slot.emphasis === 'highlight') {
        add({
          id: `${scene.id}:${slot.slot}:emphasis`,
          startSec: labelStart - 0.05,
          x: text.x - fit.size * 0.2,
          y: text.y + fit.size * 0.1,
          w: text.w + fit.size * 0.4,
          h: Math.max(fit.size, text.h * 0.85),
          z: -1,
          content: { kind: 'shape', shape: 'highlight' },
          anim: { type: 'draw', durationSec: 0.5 },
        });
      }
      add({
        id: `${scene.id}:${slot.slot}:label`,
        startSec: labelStart,
        ...place(slotLayout.label),
        content: {
          kind: 'text',
          text: fit.text,
          size: fit.size,
          color: 'ink',
          font: 'hand',
          align: centered ? 'center' : 'left',
        },
        anim: { type: 'handwrite', durationSec: round(writeSec), ...(hand !== 'none' && { hand }) },
        ...(slot.cue &&
          (input.captions?.handle ?? input.voice?.handle) && {
            cue: {
              timingHandle: (input.captions?.handle ?? input.voice?.handle)!,
              phrase: slot.cue,
              offsetSec: -0.15,
            },
          }),
      });
      if (slot.emphasis === 'underline') {
        add({
          id: `${scene.id}:${slot.slot}:emphasis`,
          startSec: labelStart + writeSec + 0.1,
          x: text.x,
          y: text.y + text.h - fit.size * 0.1,
          w: text.w,
          h: Math.max(14, fit.size * 0.35),
          content: { kind: 'shape', shape: 'underline', color: 'accent3' },
          anim: { type: 'draw', durationSec: 0.5 },
        });
      } else if (slot.emphasis === 'circle') {
        add({
          id: `${scene.id}:${slot.slot}:emphasis`,
          startSec: labelStart + writeSec + 0.1,
          x: text.x - fit.size * 0.5,
          y: text.y - fit.size * 0.3,
          w: text.w + fit.size,
          h: text.h + fit.size * 0.6,
          content: { kind: 'shape', shape: 'circle', color: 'accent3' },
          anim: { type: 'draw', durationSec: 0.8 },
        });
      }
    }
  });

  return items;
}

const place = (rect: Rect) => ({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });

/** An arrow's box, drawn level then turned for a vertical one. */
const placeConnector = (c: Connector) => ({
  x: c.cx - c.length / 2,
  y: c.cy - c.thickness / 2,
  w: c.length,
  h: c.thickness,
});

/** The arrow that leads into a place from the one before it. */
function connectorBefore(
  layout: SceneLayout,
  template: SceneDef['template'],
  slotName: string,
  order: number,
): Connector | undefined {
  if (template === 'free' || template === 'title' || order === 0) return undefined;
  return layout.connectors[order - 1];
}

/** Roughly where the words land inside their box: for a marker or underline that follows them. */
function textBox(area: Rect, fit: FittedText, centered: boolean) {
  const w = Math.min(area.w, fit.width);
  const h = Math.min(area.h, fit.height);
  return {
    x: area.x + (centered ? (area.w - w) / 2 : 0),
    y: area.y + (area.h - h) / 2,
    w,
    h,
  };
}

function overflowWarning(ctx: SceneContext, fit: FittedText, text: string, slot?: string) {
  if (!fit.overflow) return;
  ctx.warnings.push({
    code: 'text_overflow',
    scene: ctx.scene.id,
    ...(slot && { slot }),
    message: `"${text.slice(0, 40)}" is too long for its place in scene "${ctx.scene.id}"; shorten it`,
  });
}

/** The drawing for a slot: one this run made, a built-in one, or the nearest stand-in. */
function resolveAsset(
  ctx: SceneContext,
  slot: SceneSlot,
): Pick<VectorAsset, 'viewBox' | 'strokes'> {
  const id = slot.asset!;
  const made = ctx.input.assets.get(id);
  if (made) return made;
  const builtIn = ctx.input.registry.get(id);
  if (builtIn) return builtIn;
  const need = ctx.input.spec.assetNeeds?.find((candidate) => candidate.id === id);
  const fallback = need?.fallbackId ? ctx.input.registry.get(need.fallbackId) : undefined;
  if (fallback) {
    ctx.warnings.push({
      code: 'asset_fallback',
      scene: ctx.scene.id,
      slot: slot.slot,
      message: `drawing "${id}" was not made; used the built-in "${fallback.id}" instead`,
    });
    return fallback;
  }
  const nearest = ctx.input.registry.nearest(
    `${id.replace(/[-_]/g, ' ')} ${need?.label ?? ''} ${slot.text ?? ''}`,
  );
  if (nearest) {
    ctx.warnings.push({
      code: 'asset_fallback',
      scene: ctx.scene.id,
      slot: slot.slot,
      message: `no drawing "${id}"; used the built-in "${nearest.id}", the closest match`,
    });
    return nearest;
  }
  ctx.warnings.push({
    code: 'asset_missing',
    scene: ctx.scene.id,
    slot: slot.slot,
    message: `no drawing "${id}" and nothing close in the built-in set; drew a star`,
  });
  return ctx.input.registry.get('star')!;
}
