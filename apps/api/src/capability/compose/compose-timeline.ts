import { DEFAULT_TIMELINE_THEME, Timeline } from '@reelcraft/shared';
import type {
  CatalogAsset,
  CatalogKind,
  PlanLayer,
  PlanTheme,
  TimelineItem,
  TimelinePlan,
  TimelineTheme,
  TimingMap,
} from '@reelcraft/shared';
import { findCue, spokenWords } from './cue-timing';
import type { AssetIndex } from './catalog';
import { fitText, splitRuns } from './text-fit';

type Track = Timeline['tracks'][number];
type TrackType = Track['type'];

export type ComposeWarningCode =
  'cue_unresolved' | 'text_overflow' | 'outside_frame' | 'captions_skipped' | 'timing_missing';

export interface ComposeWarning {
  code: ComposeWarningCode;
  message: string;
  layer?: string;
}

export interface ComposeInput {
  plan: TimelinePlan;
  canvas: { width: number; height: number; fps: number };
  /** The look drawn items take; the plan's own theme is laid over it. */
  theme?: PlanTheme | undefined;
  /** Everything a layer can name, by id. */
  assets: AssetIndex;
  /** The voice-over's word timings, for cues and for captions. */
  timing?: TimingMap | undefined;
  /** How a timeline names the timings (captions follow them). */
  timingHandle?: string | undefined;
  /** The pen that follows drawn lines unless a layer says otherwise. */
  hand?: 'none' | 'marker' | 'pencil' | undefined;
}

export interface ComposeResult {
  timeline: Timeline;
  warnings: ComposeWarning[];
  /** When each layer starts and ends, by layer id (or `layer-<n>`). */
  layers: Array<{ id: string; startSec: number; endSec: number }>;
}

/** A plan that can't be made into a timeline. Every problem is listed so a model can fix them in
 * one go. */
export class ComposeError extends Error {
  constructor(
    readonly code: 'plan_invalid' | 'timeline_invalid',
    readonly issues: string[],
  ) {
    super(
      issues.length > 8
        ? `${issues.slice(0, 8).join('; ')}; and ${issues.length - 8} more`
        : issues.join('; '),
    );
  }
}

/** How long the video lingers after the last sound. */
const TAIL_SEC = 0.8;
const DEFAULT_SEC = 5;
const MAX_WORLD_PX = 20_000;
const MIN_SEC = 0.1;

const round = (value: number) => Math.round(value * 100) / 100;

const ASSET_KIND_FOR: Record<'image' | 'video' | 'audio' | 'drawing' | 'motion', CatalogKind> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  drawing: 'vector',
  motion: 'motion',
};

const TRACK_TYPE_FOR = (layer: PlanLayer): TrackType =>
  layer.kind === 'audio'
    ? 'audio'
    : layer.kind === 'captions'
      ? 'captions'
      : layer.kind === 'image' || layer.kind === 'video'
        ? boxed(layer)
          ? 'overlay'
          : 'video'
        : 'overlay';

const boxed = (layer: PlanLayer) =>
  layer.x !== undefined && layer.y !== undefined && layer.w !== undefined && layer.h !== undefined;

interface Resolved {
  layer: PlanLayer;
  name: string;
  startSec: number;
  /** Undefined until the end of the video is known, for a layer that lasts to the end. */
  endSec: number | undefined;
  asset?: CatalogAsset | undefined;
}

const nameOf = (layer: PlanLayer, index: number) => layer.id ?? `layer-${index + 1}`;

/**
 * Turns a plan of layers into a timeline: the times (from seconds or from words in the voice-over),
 * the pixels (from fractions of the frame), the assets (by id), the tracks and the camera. It
 * makes no creative choices: where things go and when is the plan's. Everything a model can get
 * wrong is reported, all at once.
 */
export function composeTimeline(input: ComposeInput): ComposeResult {
  const { plan, canvas } = input;
  const issues: string[] = [];
  const warnings: ComposeWarning[] = [];
  const W = canvas.width;
  const H = canvas.height;
  const words = spokenWords(input.timing);

  const names = plan.layers.map(nameOf);
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) issues.push(`two layers are called "${name}"`);
    seen.add(name);
  }

  /* ---------------------------------------------------------------- checks per layer */
  const resolved: Resolved[] = plan.layers.map((layer, index) => ({
    layer,
    name: names[index]!,
    startSec: 0,
    endSec: undefined,
  }));
  for (const entry of resolved) {
    const { layer, name } = entry;
    const need = (cond: unknown, message: string) => {
      if (!cond) issues.push(`layer "${name}" (${layer.kind}): ${message}`);
    };
    if (
      layer.kind === 'image' ||
      layer.kind === 'video' ||
      layer.kind === 'audio' ||
      layer.kind === 'drawing' ||
      layer.kind === 'motion'
    ) {
      need(layer.asset, 'needs an asset');
      if (layer.asset) {
        const wanted = ASSET_KIND_FOR[layer.kind];
        const asset = input.assets.get(wanted, layer.asset);
        const other = asset ? undefined : input.assets.find(layer.asset);
        if (!asset && other) {
          issues.push(
            `layer "${name}": asset "${layer.asset}" is ${other.kind === 'vector' ? 'a drawing' : other.kind}, not usable as ${layer.kind}`,
          );
        } else if (!asset) {
          issues.push(
            `layer "${name}": no ${layer.kind === 'drawing' ? 'drawing' : layer.kind} asset "${layer.asset}"${nearby(
              input.assets,
              layer.asset,
              wanted,
            )}`,
          );
        } else {
          entry.asset = asset;
          if (asset.kind === 'motion') {
            if (!asset.motion) issues.push(`layer "${name}": "${layer.asset}" has no code`);
          } else if (asset.kind !== 'vector' && !asset.handle) {
            issues.push(`layer "${name}": asset "${layer.asset}" has no file`);
          }
          if (asset.kind === 'vector' && !asset.vector) {
            issues.push(`layer "${name}": drawing "${layer.asset}" has no lines`);
          }
        }
      }
    }
    if (layer.kind === 'text') {
      need(layer.text || layer.runs, 'needs text');
      need(!(layer.text && layer.runs), 'has both text and runs; use one');
    }
    if (layer.kind === 'shape') need(layer.shape, 'needs a shape');
    if (layer.kind === 'drawing' || layer.kind === 'text' || layer.kind === 'shape') {
      need(boxed(layer), 'needs x, y, w and h (fractions of the frame)');
    }
    if (
      layer.kind !== 'audio' &&
      layer.kind !== 'captions' &&
      (layer.x !== undefined ||
        layer.y !== undefined ||
        layer.w !== undefined ||
        layer.h !== undefined)
    ) {
      need(boxed(layer), 'needs all of x, y, w and h');
    }
    if (layer.kind === 'audio') {
      need(!boxed(layer) && !layer.anim, 'a sound has no place on the frame');
    }
    if (layer.kind === 'captions' && !input.timing) {
      // Reported as a warning below: captions without timings are skipped, not fatal.
    }
    if (layer.anim && (layer.kind === 'image' || layer.kind === 'video')) {
      need(
        ['pop', 'fade', 'slide', 'none'].includes(layer.anim),
        'a picture or clip can pop, fade, slide or stay',
      );
      need(boxed(layer), 'anim needs x, y, w and h');
    }
    if (layer.loop) need(layer.kind === 'audio', 'only a sound can loop');
    if (layer.afterLayer && !names.includes(layer.afterLayer)) {
      issues.push(`layer "${name}": afterLayer "${layer.afterLayer}" is not a layer`);
    }
  }
  if (issues.length) throw new ComposeError('plan_invalid', issues);

  /* ---------------------------------------------------------------- when */
  const byName = new Map(resolved.map((entry) => [entry.name, entry]));
  const cueTime = (phrase: string, who: string): number | undefined => {
    const found = findCue(phrase, words);
    if (found === undefined) {
      warnings.push({
        code: input.timing ? 'cue_unresolved' : 'timing_missing',
        layer: who,
        message: input.timing
          ? `could not find "${phrase}" in the narration for "${who}"; placed after the layer before it instead`
          : `"${who}" is placed by the words "${phrase}" but there are no word timings; placed after the layer before it instead`,
      });
    }
    return found;
  };

  const knownLength = (entry: Resolved): number | undefined =>
    entry.layer.durationSec ??
    (entry.layer.kind === 'audio' && !entry.layer.loop ? entry.asset?.durationSec : undefined);

  const startOf = new Map<string, number>();
  const visiting = new Set<string>();
  const compute = (entry: Resolved, index: number): number => {
    const cached = startOf.get(entry.name);
    if (cached !== undefined) return cached;
    if (visiting.has(entry.name)) {
      throw new ComposeError('plan_invalid', [
        `layers follow each other in a circle at "${entry.name}"`,
      ]);
    }
    visiting.add(entry.name);
    const { layer } = entry;
    let base: number | undefined;
    if (layer.atCue) base = cueTime(layer.atCue, entry.name);
    if (base === undefined && layer.atSec !== undefined) base = layer.atSec;
    if (base === undefined && layer.afterLayer) {
      const target = byName.get(layer.afterLayer)!;
      const targetStart = compute(target, resolved.indexOf(target));
      const length = knownLength(target);
      if (length === undefined) {
        throw new ComposeError('plan_invalid', [
          `layer "${entry.name}" follows "${target.name}", which has no known length; give "${target.name}" a durationSec`,
        ]);
      }
      base = targetStart + length;
    }
    if (base === undefined && layer.atCue && index > 0) {
      // A cue that wasn't found: after the layer before it, so the order still reads right.
      const before = resolved[index - 1]!;
      base = compute(before, index - 1) + 0.5;
    }
    const start = Math.max(0, round((base ?? 0) + (layer.offsetSec ?? 0)));
    visiting.delete(entry.name);
    startOf.set(entry.name, start);
    return start;
  };
  resolved.forEach((entry, index) => {
    entry.startSec = compute(entry, index);
  });

  // The end: as long as the longest sound plus a short rest, or the last layer that has a length.
  const audioEnds = resolved.flatMap((entry) => {
    const length = knownLength(entry);
    return entry.layer.kind === 'audio' && !entry.layer.loop && length !== undefined
      ? [entry.startSec + length]
      : [];
  });
  const explicitEnds = resolved.flatMap((entry) =>
    entry.layer.durationSec !== undefined ? [entry.startSec + entry.layer.durationSec] : [],
  );
  const endSec = round(
    plan.durationSec ??
      (audioEnds.length
        ? Math.max(...audioEnds) + TAIL_SEC
        : explicitEnds.length
          ? Math.max(...explicitEnds)
          : Math.max(DEFAULT_SEC, ...resolved.map((entry) => entry.startSec + 1))),
  );
  for (const entry of resolved) {
    const length = knownLength(entry);
    entry.endSec = round(entry.startSec + (length ?? Math.max(MIN_SEC, endSec - entry.startSec)));
  }

  /* ---------------------------------------------------------------- world and camera */
  const frames = (value: number, axis: 'x' | 'y') => value * (axis === 'x' ? W : H);
  const cameraKeys = (plan.camera ?? []).map((key, index) => {
    let at = key.atCue ? cueTime(key.atCue, `camera key ${index + 1}`) : undefined;
    at ??= key.atSec ?? 0;
    return { ...key, at: round(Math.max(0, at)) };
  });
  cameraKeys.sort((a, b) => a.at - b.at);

  const worldLayers = resolved.filter(
    (entry) =>
      entry.layer.kind !== 'audio' &&
      entry.layer.kind !== 'captions' &&
      boxed(entry.layer) &&
      (entry.layer.space ?? 'world') === 'world',
  );
  const extentX = Math.max(
    1,
    ...worldLayers.map((entry) => entry.layer.x! + entry.layer.w!),
    ...cameraKeys.map((key) => key.x + 0.5),
  );
  const extentY = Math.max(
    1,
    ...worldLayers.map((entry) => entry.layer.y! + entry.layer.h!),
    ...cameraKeys.map((key) => key.y + 0.5),
  );
  const needsWorld =
    Boolean(plan.world) || cameraKeys.length > 0 || extentX > 1.001 || extentY > 1.001;
  const world = needsWorld
    ? {
        width: Math.round((plan.world?.width ?? Math.ceil(extentX - 0.001)) * W),
        height: Math.round((plan.world?.height ?? Math.ceil(extentY - 0.001)) * H),
      }
    : undefined;
  if (world && (world.width > MAX_WORLD_PX || world.height > MAX_WORLD_PX)) {
    throw new ComposeError('plan_invalid', [
      `the world is ${world.width} by ${world.height} pixels; keep it under ${MAX_WORLD_PX}. Use a smaller world or fewer frames`,
    ]);
  }
  const camera = cameraKeys.length
    ? {
        keys: [
          ...(cameraKeys[0]!.at > 0
            ? [{ atSec: 0, cx: Math.round(W / 2), cy: Math.round(H / 2), zoom: 1 }]
            : []),
          ...cameraKeys.map((key) => ({
            atSec: key.at,
            cx: Math.round(frames(key.x, 'x')),
            cy: Math.round(frames(key.y, 'y')),
            zoom: Math.round((key.zoom ?? 1) * 10_000) / 10_000,
            ...(key.ease && { ease: key.ease }),
          })),
        ],
      }
    : undefined;

  /* ---------------------------------------------------------------- items and tracks */
  const tracks = new Map<string, { type: TrackType; items: TimelineItem[] }>();
  const trackFor = (layer: PlanLayer, name: string): { items: TimelineItem[] } | undefined => {
    const type = TRACK_TYPE_FOR(layer);
    const id = layer.track ?? type;
    const existing = tracks.get(id);
    if (existing && existing.type !== type) {
      issues.push(
        `layer "${name}" is ${layer.kind} and belongs on a ${type} track, but track "${id}" is a ${existing.type} track`,
      );
      return undefined;
    }
    if (existing) return existing;
    const created = { type, items: [] as TimelineItem[] };
    tracks.set(id, created);
    return created;
  };

  const theme = Object.assign(
    {},
    DEFAULT_TIMELINE_THEME,
    stripUndefined(input.theme),
    stripUndefined(plan.theme),
  ) as TimelineTheme;
  // A font named by a font asset's id loads from that file, under its family name; any other name
  // is a family the renderer already has (the theme's hand and body fonts, or a system font).
  const fonts = new Map<string, string>();
  const fontFamily = (name: string): string => {
    const asset = input.assets.get('font', name);
    if (!asset?.handle) return name;
    const family = asset.family ?? asset.label ?? name;
    fonts.set(family, asset.handle);
    return family;
  };
  theme.fontHand = fontFamily(theme.fontHand);
  theme.fontBody = fontFamily(theme.fontBody);
  const hand = input.hand ?? 'none';
  const timeSpan = (entry: Resolved) => round(Math.max(MIN_SEC, entry.endSec! - entry.startSec));
  const keyframesOf = (layer: PlanLayer) =>
    layer.keyframes?.map((key) => ({
      atSec: key.atSec,
      ...(key.x !== undefined && { x: round(key.x * W) }),
      ...(key.y !== undefined && { y: round(key.y * H) }),
      ...(key.scale !== undefined && { scale: key.scale }),
      ...(key.rotate !== undefined && { rotate: key.rotate }),
      ...(key.opacity !== undefined && { opacity: key.opacity }),
    }));
  const boxPx = (layer: PlanLayer) => ({
    x: round(layer.x! * W),
    y: round(layer.y! * H),
    w: round(layer.w! * W),
    h: round(layer.h! * H),
  });
  const cueOf = (layer: PlanLayer) =>
    layer.atCue && input.timingHandle
      ? {
          cue: {
            timingHandle: input.timingHandle,
            phrase: layer.atCue,
            ...(layer.offsetSec !== undefined && { offsetSec: layer.offsetSec }),
          },
        }
      : {};

  for (const entry of resolved) {
    const { layer, name } = entry;
    const track = trackFor(layer, name);
    if (!track) continue;
    const span = timeSpan(entry);
    const place = {
      ...(layer.space && { space: layer.space }),
      ...(layer.rotate !== undefined && { rotate: layer.rotate }),
      ...(layer.z !== undefined && { z: layer.z }),
    };

    if (layer.kind === 'audio') {
      const asset = entry.asset!;
      const volume = layer.volume;
      const length = asset.durationSec;
      if (layer.loop) {
        if (!length || length < 0.5) {
          issues.push(`layer "${name}": a looping sound needs a source with a known length`);
          continue;
        }
        const until = layer.durationSec !== undefined ? entry.startSec + layer.durationSec : endSec;
        let count = 0;
        for (let at = entry.startSec; at < until - 0.05 && count < 60; at += length, count += 1) {
          const last = at + length >= until - 0.05;
          track.items.push({
            type: 'media',
            handle: asset.handle!,
            startSec: round(at),
            durationSec: round(Math.min(length, until - at)),
            ...(volume !== undefined && { volume }),
            ...(layer.fadeInSec && count === 0 && { fadeInSec: layer.fadeInSec }),
            ...(last && layer.fadeOutSec && { fadeOutSec: layer.fadeOutSec }),
          });
        }
      } else {
        track.items.push({
          type: 'media',
          handle: asset.handle!,
          startSec: entry.startSec,
          ...(knownLength(entry) !== undefined && { durationSec: round(knownLength(entry)!) }),
          ...(layer.trimInSec !== undefined && { trimInSec: layer.trimInSec }),
          ...(volume !== undefined && { volume }),
          ...(layer.fadeInSec !== undefined && { fadeInSec: layer.fadeInSec }),
          ...(layer.fadeOutSec !== undefined && { fadeOutSec: layer.fadeOutSec }),
        });
      }
      continue;
    }

    if (layer.kind === 'captions') {
      if (!input.timingHandle || !input.timing) {
        warnings.push({
          code: 'captions_skipped',
          layer: name,
          message: `captions "${name}" were asked for but there are no word timings to follow`,
        });
        continue;
      }
      track.items.push({
        type: 'captions',
        timingHandle: input.timingHandle,
        styleId: layer.style ?? 'caption.clean',
        startSec: entry.startSec,
      });
      continue;
    }

    if (layer.kind === 'image' || layer.kind === 'video') {
      const asset = entry.asset!;
      const duration =
        layer.kind === 'video' && asset.durationSec && layer.durationSec === undefined
          ? Math.min(asset.durationSec, span)
          : span;
      track.items.push({
        type: 'media',
        handle: asset.handle!,
        startSec: entry.startSec,
        durationSec: round(duration),
        ...(layer.fit && { fit: layer.fit }),
        ...(layer.trimInSec !== undefined && { trimInSec: layer.trimInSec }),
        ...(layer.volume !== undefined && { volume: layer.volume }),
        ...(layer.fadeInSec !== undefined && { fadeInSec: layer.fadeInSec }),
        ...(layer.fadeOutSec !== undefined && { fadeOutSec: layer.fadeOutSec }),
        ...(layer.reveal && { reveal: { type: layer.reveal } }),
        ...(boxed(layer) && {
          ...boxPx(layer),
          ...place,
          ...(layer.anim && { anim: animOf(layer, hand, false) }),
          ...(layer.keyframes && { keyframes: keyframesOf(layer) }),
        }),
      });
      if (layer.space === 'screen') warnOutside(layer, name, warnings);
      continue;
    }

    if (layer.kind === 'motion') {
      const motion = entry.asset!.motion!;
      // Drawn by the final render from its code, on the screen: in its box, or over the whole frame.
      track.items.push({
        type: 'motion',
        id: name,
        startSec: entry.startSec,
        durationSec: round(
          layer.durationSec === undefined ? Math.min(motion.durationSec, span) : span,
        ),
        width: motion.width,
        height: motion.height,
        code: motion.code,
        ...(motion.props && { props: motion.props }),
        ...(motion.assets?.length && { files: motion.assets }),
        ...(motion.notes && { notes: motion.notes }),
        ...(boxed(layer) && {
          x: round(layer.x! * W),
          y: round(layer.y! * H),
          w: round(layer.w! * W),
          h: round(layer.h! * H),
          ...(layer.rotate !== undefined && { rotate: layer.rotate }),
          ...(layer.z !== undefined && { z: layer.z }),
        }),
      });
      continue;
    }

    // Drawn items: a drawing, words or a shape.
    const box = boxPx(layer);
    if (layer.space === 'screen') warnOutside(layer, name, warnings);
    const anim = animOf(layer, hand, true);
    let content: Extract<TimelineItem, { type: 'graphic' }>['content'];
    if (layer.kind === 'drawing') {
      const vector = entry.asset!.vector!;
      content = {
        kind: 'paths',
        viewBox: vector.viewBox,
        strokes: layer.color ? recolor(vector.strokes, layer.color) : vector.strokes,
      };
    } else if (layer.kind === 'shape') {
      content = { kind: 'shape', shape: layer.shape!, ...(layer.color && { color: layer.color }) };
    } else {
      const maxSize = layer.size ? layer.size * Math.min(W, H) : box.h * 0.9;
      const words = layer.runs ? layer.runs.map((run) => run.text).join('') : layer.text!;
      const fit = fitText(words, { w: box.w, h: box.h }, maxSize);
      if (fit.overflow) {
        warnings.push({
          code: 'text_overflow',
          layer: name,
          message: `the words in "${name}" are too long for their box even at the smallest size; shorten them or make the box bigger`,
        });
      }
      content = {
        kind: 'text',
        text: fit.text,
        size: fit.size,
        ...(layer.color && { color: layer.color }),
        ...(layer.font && { font: fontFamily(layer.font) }),
        ...(layer.weight !== undefined && { weight: layer.weight }),
        align: layer.align ?? 'left',
        ...(layer.runs && {
          runs: splitRuns(fit.text, layer.runs).map((run) => ({
            ...run,
            ...(run.font && { font: fontFamily(run.font) }),
          })),
        }),
      };
    }
    track.items.push({
      type: 'graphic',
      id: name,
      startSec: entry.startSec,
      durationSec: span,
      ...box,
      ...place,
      content,
      anim,
      ...(layer.keyframes && { keyframes: keyframesOf(layer) }),
      ...cueOf(layer),
    });
  }

  for (const duck of plan.ducks ?? []) {
    const target = tracks.get(duck.track);
    if (!target) issues.push(`ducks: there is no track "${duck.track}"`);
    else if (!tracks.has(duck.under)) issues.push(`ducks: there is no track "${duck.under}"`);
    else if (target.type !== 'audio')
      issues.push(`ducks: track "${duck.track}" is not an audio track`);
  }
  if (issues.length) throw new ComposeError('plan_invalid', issues);

  const order: Record<TrackType, number> = { video: 0, overlay: 1, captions: 2, audio: 3 };
  const outTracks: Track[] = [...tracks.entries()]
    .filter(([, track]) => track.items.length > 0)
    .sort((a, b) => order[a[1].type] - order[b[1].type])
    .map(([id, track]) => ({
      id,
      type: track.type,
      ...(plan.ducks?.find((duck) => duck.track === id) && {
        duckUnder: plan.ducks.find((duck) => duck.track === id)!.under,
      }),
      items: [...track.items].sort(
        (a, b) =>
          (a.type === 'captions' ? (a.startSec ?? 0) : a.startSec) -
          (b.type === 'captions' ? (b.startSec ?? 0) : b.startSec),
      ),
    }));

  const usesGraphics = outTracks.some((track) =>
    track.items.some((item) => item.type === 'graphic'),
  );
  const parsed = Timeline.safeParse({
    version: 2,
    canvas: {
      width: W,
      height: H,
      fps: canvas.fps,
      ...(plan.background && { background: plan.background }),
    },
    ...(world && { world }),
    ...(camera && { camera }),
    ...(usesGraphics || plan.theme || input.theme ? { theme } : {}),
    ...(fonts.size > 0 && {
      fonts: [...fonts].map(([family, handle]) => ({ family, handle })),
    }),
    tracks: outTracks,
  });
  if (!parsed.success) {
    throw new ComposeError(
      'timeline_invalid',
      parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return {
    timeline: parsed.data,
    warnings,
    layers: resolved.map((entry) => ({
      id: entry.name,
      startSec: entry.startSec,
      endSec: entry.endSec!,
    })),
  };
}

/** The animation of a layer, with the default pen for drawn lines. */
function animOf(layer: PlanLayer, hand: 'none' | 'marker' | 'pencil', drawn: boolean) {
  const type = layer.anim ?? (drawn ? (layer.kind === 'text' ? 'fade' : 'draw') : 'none');
  const pen = layer.hand ?? (type === 'draw' || type === 'handwrite' ? hand : undefined);
  return {
    type,
    ...(layer.animSec !== undefined && { durationSec: layer.animSec }),
    ...(layer.from && { from: layer.from }),
    ...(pen && pen !== 'none' && { hand: pen }),
    ...(type === 'type' && layer.caret && { caret: true }),
  };
}

const recolor = (
  strokes: ReadonlyArray<{
    d: string;
    color?: string | undefined;
    fill?: string | undefined;
    weight?: 'thin' | 'normal' | 'bold' | undefined;
  }>,
  color: string,
) =>
  strokes.map((stroke) => ({
    d: stroke.d,
    ...(stroke.weight && { weight: stroke.weight }),
    ...(stroke.fill !== undefined ? { fill: stroke.fill } : {}),
    ...(stroke.color !== undefined || stroke.fill === undefined ? { color } : {}),
  }));

function warnOutside(layer: PlanLayer, name: string, warnings: ComposeWarning[]) {
  const outside =
    layer.x! < -0.05 ||
    layer.y! < -0.05 ||
    layer.x! + layer.w! > 1.05 ||
    layer.y! + layer.h! > 1.05;
  if (outside) {
    warnings.push({
      code: 'outside_frame',
      layer: name,
      message: `"${name}" sits partly outside the frame; screen items should keep x and y from 0 to 1`,
    });
  }
}

/** The closest ids, for "no asset X": a few of the same kind that share a word or letters. */
function nearby(assets: AssetIndex, wanted: string, kind: CatalogKind): string {
  const lower = wanted.toLowerCase();
  const same = assets.ofKind(kind);
  const close = same
    .filter(
      (asset) =>
        asset.id.toLowerCase().includes(lower) ||
        lower.includes(asset.id.toLowerCase()) ||
        lower
          .split(/[-_.\s]/)
          .some((part) => part.length > 2 && asset.id.toLowerCase().includes(part)),
    )
    .slice(0, 5)
    .map((asset) => asset.id);
  const list = close.length ? close : same.slice(0, 8).map((asset) => asset.id);
  return list.length ? `. Available: ${list.join(', ')}` : '. There are no assets of that kind';
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  return value
    ? (Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>)
    : {};
}
