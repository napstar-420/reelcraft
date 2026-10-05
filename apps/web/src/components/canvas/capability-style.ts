import {
  Clapperboard,
  FileOutput,
  FileText,
  Globe,
  Image as ImageIcon,
  Music,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

export type CapabilityStyle = {
  icon: LucideIcon;
  /** Background of the icon chip and the colour swatch on stage pills. */
  chip: string;
  /** Icon colour on `chip`; the light hues need dark ink to stay legible. */
  ink: string;
};

const WHITE = 'text-white';
const DARK = 'text-slate-900';

/** A muted accent per capability family — not a status colour, so it never
 * reads as passed/failed the way the run-state palette does. */
const CAPABILITY_STYLES: Record<string, CapabilityStyle> = {
  'text.generate': { icon: FileText, chip: 'bg-emerald-500', ink: WHITE },
  'image.generate': { icon: ImageIcon, chip: 'bg-pink-500', ink: WHITE },
  'video.generate': { icon: Clapperboard, chip: 'bg-orange-500', ink: WHITE },
  'video.concat': { icon: Clapperboard, chip: 'bg-orange-500', ink: WHITE },
  'timeline.render': { icon: Clapperboard, chip: 'bg-orange-500', ink: WHITE },
  'audio.speech': { icon: Music, chip: 'bg-blue-500', ink: WHITE },
  'media.analyze': { icon: Sparkles, chip: 'bg-cyan-500', ink: DARK },
  'human.input': { icon: UserRound, chip: 'bg-amber-500', ink: DARK },
  'human.timeline_edit': { icon: UserRound, chip: 'bg-amber-500', ink: DARK },
  'browser.automate': { icon: Globe, chip: 'bg-slate-500', ink: WHITE },
  'subtitles.export': { icon: FileOutput, chip: 'bg-violet-500', ink: WHITE },
  'publish.stub': { icon: FileOutput, chip: 'bg-violet-500', ink: WHITE },
};

const DEFAULT_STYLE: CapabilityStyle = {
  icon: Sparkles,
  chip: 'bg-muted-foreground',
  ink: WHITE,
};

export function capabilityStyle(capability: string): CapabilityStyle {
  return CAPABILITY_STYLES[capability] ?? DEFAULT_STYLE;
}
