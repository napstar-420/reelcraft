import type { GraphicStroke } from '@reelcraft/shared';

/**
 * The drawings built into Reelcraft, on a 100 by 100 grid. Lines are listed in the order they
 * are drawn. Colours are theme colours, so each drawing takes on a video's theme. These are
 * deliberately simple: they are a starting set, fallbacks for a drawing a run could not make,
 * and examples the drawing prompt shows the model.
 */
export interface AssetDef {
  id: string;
  label: string;
  /** Words to find it by, such as `idea` for a lightbulb. */
  tags: string[];
  strokes: GraphicStroke[];
}

const r = (n: number) => Math.round(n * 100) / 100;

/** An ellipse as one closed path of four curves. */
const ellipse = (cx: number, cy: number, rx: number, ry: number) => {
  const k = 0.5523;
  return [
    `M ${r(cx)} ${r(cy - ry)}`,
    `C ${r(cx + rx * k)} ${r(cy - ry)} ${r(cx + rx)} ${r(cy - ry * k)} ${r(cx + rx)} ${r(cy)}`,
    `C ${r(cx + rx)} ${r(cy + ry * k)} ${r(cx + rx * k)} ${r(cy + ry)} ${r(cx)} ${r(cy + ry)}`,
    `C ${r(cx - rx * k)} ${r(cy + ry)} ${r(cx - rx)} ${r(cy + ry * k)} ${r(cx - rx)} ${r(cy)}`,
    `C ${r(cx - rx)} ${r(cy - ry * k)} ${r(cx - rx * k)} ${r(cy - ry)} ${r(cx)} ${r(cy - ry)} Z`,
  ].join(' ');
};
const circle = (cx: number, cy: number, radius: number) => ellipse(cx, cy, radius, radius);
const rect = (x: number, y: number, w: number, h: number) =>
  `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
const line = (x1: number, y1: number, x2: number, y2: number) => `M ${x1} ${y1} L ${x2} ${y2}`;
const polar = (cx: number, cy: number, radius: number, degrees: number) => ({
  x: r(cx + radius * Math.cos((degrees * Math.PI) / 180)),
  y: r(cy + radius * Math.sin((degrees * Math.PI) / 180)),
});
/** Short lines pointing out from a centre, like the rays of a sun. */
const rays = (cx: number, cy: number, from: number, to: number, count: number, start = -90) =>
  Array.from({ length: count }, (_, i) => {
    const a = polar(cx, cy, from, start + (360 / count) * i);
    const b = polar(cx, cy, to, start + (360 / count) * i);
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }).join(' ');
const star = (cx: number, cy: number, outer: number, inner: number, points = 5) =>
  Array.from({ length: points * 2 }, (_, i) => {
    const p = polar(cx, cy, i % 2 === 0 ? outer : inner, -90 + (180 / points) * i);
    return `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`;
  }).join(' ') + ' Z';
const gear = (cx: number, cy: number, inner: number, outer: number, teeth: number) => {
  const step = 360 / teeth;
  const parts: string[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const base = -90 + step * i;
    const points = [
      polar(cx, cy, inner, base - step * 0.25),
      polar(cx, cy, outer, base - step * 0.14),
      polar(cx, cy, outer, base + step * 0.14),
      polar(cx, cy, inner, base + step * 0.25),
    ];
    points.forEach((p, j) => parts.push(`${i === 0 && j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`));
  }
  return `${parts.join(' ')} Z`;
};

const ink = (d: string, extra: Partial<GraphicStroke> = {}): GraphicStroke => ({ d, ...extra });
const accent = (d: string, color: string, extra: Partial<GraphicStroke> = {}): GraphicStroke => ({
  d,
  color,
  ...extra,
});
const filled = (d: string, fill: string, extra: Partial<GraphicStroke> = {}): GraphicStroke => ({
  d,
  color: 'ink',
  fill,
  ...extra,
});
const bold = (d: string, color?: string): GraphicStroke => ({
  d,
  weight: 'bold',
  ...(color ? { color } : {}),
});
const thin = (d: string): GraphicStroke => ({ d, weight: 'thin' });

/** A stick figure's head and body; the poses add arms and legs. */
const person = (...limbs: string[]): GraphicStroke[] => [
  ink(circle(50, 17, 9)),
  ink(line(50, 26, 50, 60)),
  ...limbs.map((d) => ink(d)),
];

export const ASSET_DEFS: AssetDef[] = [
  // Arrows and marks
  {
    id: 'arrow-right',
    label: 'Arrow pointing right',
    tags: ['next', 'then', 'leads to', 'direction'],
    strokes: [bold(line(8, 50, 90, 50)), bold('M 70 28 L 92 50 L 70 72')],
  },
  {
    id: 'arrow-left',
    label: 'Arrow pointing left',
    tags: ['back', 'previous'],
    strokes: [bold(line(92, 50, 10, 50)), bold('M 30 28 L 8 50 L 30 72')],
  },
  {
    id: 'arrow-up',
    label: 'Arrow pointing up',
    tags: ['increase', 'grow', 'rise'],
    strokes: [bold(line(50, 92, 50, 10)), bold('M 28 30 L 50 8 L 72 30')],
  },
  {
    id: 'arrow-down',
    label: 'Arrow pointing down',
    tags: ['decrease', 'fall', 'drop'],
    strokes: [bold(line(50, 8, 50, 90)), bold('M 28 70 L 50 92 L 72 70')],
  },
  {
    id: 'arrow-curved',
    label: 'Curved arrow',
    tags: ['flow', 'leads to', 'turn'],
    strokes: [bold('M 10 78 C 10 30 50 14 84 30'), bold('M 66 14 L 86 30 L 66 46')],
  },
  {
    id: 'arrow-loop',
    label: 'Circular arrow, a loop that repeats',
    tags: ['repeat', 'cycle', 'loop', 'again', 'habit loop'],
    strokes: [
      bold('M 82 36 C 70 12 30 10 18 38 C 8 62 28 88 52 88 C 70 88 84 76 86 60'),
      bold('M 94 48 L 84 34 L 70 44'),
    ],
  },
  {
    id: 'arrow-double',
    label: 'Arrow pointing both ways',
    tags: ['between', 'swap', 'exchange'],
    strokes: [
      bold(line(14, 50, 86, 50)),
      bold('M 30 32 L 10 50 L 30 68'),
      bold('M 70 32 L 90 50 L 70 68'),
    ],
  },
  {
    id: 'underline-wavy',
    label: 'Wavy underline',
    tags: ['emphasis', 'important', 'underline'],
    strokes: [accent('M 4 52 C 20 30 30 76 50 50 S 80 28 96 50', 'accent3', { weight: 'bold' })],
  },
  {
    id: 'circle-scribble',
    label: 'Hand-drawn circle around something',
    tags: ['highlight', 'focus', 'important', 'circle'],
    strokes: [
      accent(
        'M 50 8 C 78 8 94 28 92 52 C 90 78 68 92 46 90 C 22 88 8 70 10 46 C 12 22 34 10 58 12 C 70 13 80 20 84 28',
        'accent3',
        { weight: 'bold' },
      ),
    ],
  },
  {
    id: 'box-rough',
    label: 'Hand-drawn box',
    tags: ['frame', 'container', 'box'],
    strokes: [ink('M 8 14 L 92 10 L 90 88 L 10 91 L 7 12', { weight: 'bold' })],
  },
  {
    id: 'checkmark',
    label: 'Checkmark, done',
    tags: ['done', 'yes', 'correct', 'complete', 'good'],
    strokes: [accent('M 14 54 L 38 80 L 88 18', 'accent2', { weight: 'bold' })],
  },
  {
    id: 'cross',
    label: 'Cross, wrong or stop',
    tags: ['no', 'wrong', 'bad', 'stop', 'avoid'],
    strokes: [
      accent(line(18, 18, 82, 82), 'accent3', { weight: 'bold' }),
      accent(line(82, 18, 18, 82), 'accent3', { weight: 'bold' }),
    ],
  },
  {
    id: 'star',
    label: 'Star',
    tags: ['favourite', 'best', 'quality', 'reward'],
    strokes: [filled(star(50, 52, 42, 18), 'highlight')],
  },
  {
    id: 'sparkle',
    label: 'Burst of short lines, for excitement',
    tags: ['excited', 'new', 'celebrate', 'shine', 'burst'],
    strokes: [ink(rays(50, 50, 22, 44, 8), { weight: 'bold' }), ink(circle(50, 50, 6))],
  },
  {
    id: 'question-mark',
    label: 'Question mark',
    tags: ['why', 'question', 'unknown', 'ask'],
    strokes: [
      bold('M 32 30 C 32 6 72 6 70 30 C 69 46 50 48 50 64'),
      ink(circle(50, 84, 3.5), { weight: 'bold' }),
    ],
  },
  {
    id: 'exclamation-mark',
    label: 'Exclamation mark',
    tags: ['warning', 'important', 'alert', 'attention'],
    strokes: [bold(line(50, 10, 50, 62), 'accent3'), ink(circle(50, 84, 4), { weight: 'bold' })],
  },
  {
    id: 'plus',
    label: 'Plus sign',
    tags: ['add', 'more', 'and'],
    strokes: [bold(line(50, 14, 50, 86)), bold(line(14, 50, 86, 50))],
  },
  {
    id: 'equals',
    label: 'Equals sign',
    tags: ['equals', 'result', 'is'],
    strokes: [bold(line(14, 36, 86, 36)), bold(line(14, 64, 86, 64))],
  },
  // Things
  {
    id: 'lightbulb',
    label: 'Lightbulb, an idea',
    tags: ['idea', 'insight', 'think', 'tip', 'cue'],
    strokes: [
      ink(
        'M 50 12 C 28 12 18 30 24 46 C 28 56 36 60 38 72 L 62 72 C 64 60 72 56 76 46 C 82 30 72 12 50 12 Z',
        {
          fill: 'highlight',
        },
      ),
      ink(line(40, 82, 60, 82)),
      ink(line(43, 90, 57, 90)),
      thin('M 42 52 L 50 42 L 58 52'),
      ink('M 10 14 L 18 22 M 90 14 L 82 22 M 4 44 L 12 44 M 96 44 L 88 44'),
    ],
  },
  {
    id: 'clock',
    label: 'Clock, time',
    tags: ['time', 'wait', 'schedule', 'deadline', 'minutes', 'morning'],
    strokes: [
      ink(circle(50, 50, 40), { weight: 'bold' }),
      ink(line(50, 50, 50, 25)),
      ink(line(50, 50, 68, 58)),
      thin('M 50 14 L 50 20 M 86 50 L 80 50 M 50 86 L 50 80 M 14 50 L 20 50'),
    ],
  },
  {
    id: 'calendar',
    label: 'Calendar, days',
    tags: ['day', 'date', 'daily', 'week', 'consistent', 'schedule'],
    strokes: [
      ink(rect(14, 22, 72, 66), { weight: 'bold' }),
      ink(line(14, 40, 86, 40)),
      ink('M 32 14 L 32 28 M 68 14 L 68 28'),
      thin('M 26 54 L 38 54 M 46 54 L 58 54 M 66 54 L 76 54 M 26 70 L 38 70 M 46 70 L 58 70'),
      accent('M 64 66 L 70 74 L 80 62', 'accent2'),
    ],
  },
  {
    id: 'coffee-mug',
    label: 'Coffee mug',
    tags: ['coffee', 'drink', 'morning', 'break', 'cue'],
    strokes: [
      filled('M 18 36 L 18 70 C 18 82 28 88 40 88 L 48 88 C 60 88 70 82 70 70 L 70 36 Z', 'paper'),
      ink('M 70 46 C 90 46 90 72 70 72'),
      ink('M 12 94 L 78 94'),
      thin('M 30 26 C 24 18 36 14 30 6 M 48 26 C 42 18 54 14 48 6'),
    ],
  },
  {
    id: 'trophy',
    label: 'Trophy, a reward',
    tags: ['reward', 'win', 'success', 'prize', 'achievement', 'goal'],
    strokes: [
      filled('M 30 14 L 70 14 L 68 44 C 66 58 58 64 50 64 C 42 64 34 58 32 44 Z', 'highlight'),
      ink('M 30 22 C 10 22 10 44 33 48 M 70 22 C 90 22 90 44 67 48'),
      ink(line(50, 64, 50, 78)),
      ink('M 34 90 L 66 90 L 62 78 L 38 78 Z'),
    ],
  },
  {
    id: 'phone',
    label: 'Phone',
    tags: ['phone', 'mobile', 'call', 'app', 'notification', 'screen'],
    strokes: [
      ink(
        'M 32 8 L 68 8 Q 74 8 74 14 L 74 86 Q 74 92 68 92 L 32 92 Q 26 92 26 86 L 26 14 Q 26 8 32 8 Z',
        { weight: 'bold' },
      ),
      thin('M 32 20 L 68 20 M 32 78 L 68 78'),
      thin('M 38 36 L 62 36 M 38 46 L 56 46 M 38 56 L 62 56'),
    ],
  },
  {
    id: 'book',
    label: 'Open book',
    tags: ['read', 'learn', 'study', 'knowledge', 'book'],
    strokes: [
      ink(
        'M 50 25 C 38 18 22 18 10 22 L 10 78 C 22 74 38 74 50 82 C 62 74 78 74 90 78 L 90 22 C 78 18 62 18 50 25 Z',
      ),
      ink(line(50, 25, 50, 82)),
      thin(
        'M 18 36 C 26 34 34 35 42 38 M 18 48 C 26 46 34 47 42 50 M 58 38 C 66 35 74 34 82 36 M 58 50 C 66 47 74 46 82 48',
      ),
    ],
  },
  {
    id: 'house',
    label: 'House, home',
    tags: ['home', 'house', 'family', 'place'],
    strokes: [
      ink('M 8 48 L 50 12 L 92 48', { weight: 'bold' }),
      ink('M 18 42 L 18 88 L 82 88 L 82 42'),
      ink('M 42 88 L 42 62 L 58 62 L 58 88'),
      accent(rect(64, 54, 12, 12), 'accent1'),
    ],
  },
  {
    id: 'heart',
    label: 'Heart',
    tags: ['love', 'like', 'health', 'care'],
    strokes: [
      filled(
        'M 50 86 C 20 64 8 42 20 26 C 30 14 46 18 50 30 C 54 18 70 14 80 26 C 92 42 80 64 50 86 Z',
        'accent3',
      ),
    ],
  },
  {
    id: 'key',
    label: 'Key',
    tags: ['key', 'access', 'secret', 'unlock', 'solution'],
    strokes: [
      ink(circle(28, 50, 15), { weight: 'bold' }),
      ink(line(43, 50, 90, 50), { weight: 'bold' }),
      ink('M 76 50 L 76 64 M 86 50 L 86 60'),
    ],
  },
  {
    id: 'lock',
    label: 'Padlock',
    tags: ['lock', 'secure', 'private', 'safe', 'stuck'],
    strokes: [
      filled(rect(24, 44, 52, 44), 'highlight'),
      ink('M 34 44 L 34 32 C 34 12 66 12 66 32 L 66 44', { weight: 'bold' }),
      ink(circle(50, 62, 5)),
      ink(line(50, 67, 50, 78)),
    ],
  },
  {
    id: 'magnifier',
    label: 'Magnifying glass',
    tags: ['search', 'find', 'look', 'examine', 'research'],
    strokes: [ink(circle(42, 42, 27), { weight: 'bold' }), bold(line(62, 62, 90, 90))],
  },
  {
    id: 'gear',
    label: 'Gear, how something works',
    tags: ['settings', 'process', 'system', 'work', 'mechanism', 'routine'],
    strokes: [ink(gear(50, 50, 30, 42, 8), { weight: 'bold' }), ink(circle(50, 50, 12))],
  },
  {
    id: 'target',
    label: 'Target with an arrow',
    tags: ['goal', 'aim', 'focus', 'target'],
    strokes: [
      ink(circle(46, 54, 38)),
      ink(circle(46, 54, 24)),
      ink(circle(46, 54, 10), { fill: 'accent3' }),
      bold('M 46 54 L 84 16 M 84 16 L 84 30 M 84 16 L 70 16'),
    ],
  },
  {
    id: 'flag',
    label: 'Flag on a pole, a finish line',
    tags: ['goal', 'finish', 'milestone', 'achieve', 'top'],
    strokes: [bold(line(28, 8, 28, 94)), filled('M 28 12 L 82 24 L 28 44 Z', 'accent3')],
  },
  {
    id: 'stairs',
    label: 'Stairs going up, small steps',
    tags: ['steps', 'progress', 'small', 'start small', 'build', 'climb'],
    strokes: [
      ink('M 6 90 L 6 74 L 26 74 L 26 58 L 46 58 L 46 42 L 66 42 L 66 26 L 94 26 L 94 90 Z', {
        weight: 'bold',
      }),
      ink('M 80 26 L 80 8'),
      filled('M 80 8 L 94 13 L 80 18 Z', 'accent3'),
    ],
  },
  {
    id: 'sticky-note',
    label: 'Sticky note',
    tags: ['note', 'reminder', 'link', 'remember'],
    strokes: [
      filled('M 16 20 L 84 20 L 84 70 L 68 88 L 16 88 Z', 'highlight'),
      ink('M 68 88 L 68 70 L 84 70'),
      thin('M 26 36 L 72 36 M 26 48 L 64 48 M 26 60 L 50 60'),
    ],
  },
  {
    id: 'speech-bubble',
    label: 'Speech bubble',
    tags: ['say', 'talk', 'message', 'quote', 'voice'],
    strokes: [
      ink(
        'M 20 16 L 80 16 Q 90 16 90 26 L 90 54 Q 90 64 80 64 L 56 64 L 36 86 L 38 64 L 20 64 Q 10 64 10 54 L 10 26 Q 10 16 20 16 Z',
        { weight: 'bold' },
      ),
      thin('M 24 32 L 76 32 M 24 46 L 60 46'),
    ],
  },
  {
    id: 'thought-bubble',
    label: 'Thought bubble',
    tags: ['think', 'wonder', 'mind', 'thought'],
    strokes: [
      ink(ellipse(52, 36, 38, 25), { weight: 'bold' }),
      ink(circle(30, 72, 7)),
      ink(circle(18, 87, 4)),
    ],
  },
  {
    id: 'cloud',
    label: 'Cloud',
    tags: ['cloud', 'weather', 'online', 'storage'],
    strokes: [
      ink(
        'M 26 72 C 8 72 4 50 22 46 C 20 28 42 20 52 34 C 60 20 84 26 82 46 C 98 46 100 72 82 72 Z',
        {
          weight: 'bold',
        },
      ),
    ],
  },
  {
    id: 'sun',
    label: 'Sun',
    tags: ['sun', 'day', 'morning', 'bright', 'happy', 'wake up'],
    strokes: [
      ink(circle(50, 50, 18), { fill: 'highlight' }),
      ink(rays(50, 50, 28, 44, 8), { weight: 'bold' }),
    ],
  },
  {
    id: 'moon',
    label: 'Moon and stars, night',
    tags: ['night', 'sleep', 'evening', 'bed'],
    strokes: [
      filled(
        'M 66 12 C 40 14 24 36 30 60 C 36 82 62 92 84 78 C 60 76 46 56 52 36 C 55 26 60 18 66 12 Z',
        'highlight',
      ),
      ink(star(78, 28, 8, 3.5)),
      ink(star(86, 54, 5, 2.2)),
    ],
  },
  {
    id: 'tree',
    label: 'Tree',
    tags: ['tree', 'nature', 'grow', 'outside', 'park'],
    strokes: [
      ink('M 46 92 L 46 62 M 54 92 L 54 62'),
      filled(
        'M 50 8 C 30 8 16 22 22 38 C 10 46 18 66 36 64 C 42 70 58 70 64 64 C 82 66 90 46 78 38 C 84 22 70 8 50 8 Z',
        'accent2',
      ),
    ],
  },
  {
    id: 'seedling',
    label: 'Seedling, something growing',
    tags: ['grow', 'start', 'new', 'seed', 'beginning', 'small'],
    strokes: [
      bold('M 50 92 L 50 52'),
      filled('M 50 56 C 28 56 14 44 14 26 C 34 26 48 36 50 56 Z', 'accent2'),
      filled('M 50 46 C 52 28 66 14 86 14 C 86 34 72 48 50 46 Z', 'accent2'),
      ink('M 30 92 L 70 92'),
    ],
  },
  {
    id: 'coin',
    label: 'Coin, money',
    tags: ['money', 'cost', 'price', 'save', 'dollar', 'pay'],
    strokes: [
      ink(circle(50, 50, 40), { fill: 'highlight', weight: 'bold' }),
      thin(circle(50, 50, 31)),
      ink('M 60 36 C 54 28 38 32 40 42 C 42 52 60 50 60 60 C 60 70 44 72 38 62'),
      ink(line(50, 24, 50, 76), { weight: 'thin' }),
    ],
  },
  {
    id: 'envelope',
    label: 'Envelope, mail',
    tags: ['mail', 'email', 'message', 'send', 'letter'],
    strokes: [
      ink(rect(10, 24, 80, 54), { weight: 'bold' }),
      ink('M 10 24 L 50 56 L 90 24'),
      thin('M 10 78 L 36 48 M 90 78 L 64 48'),
    ],
  },
  {
    id: 'brain',
    label: 'Brain, the mind',
    tags: ['brain', 'mind', 'memory', 'think', 'habit', 'learn', 'subconscious'],
    strokes: [
      ink(
        'M 50 18 C 44 8 28 8 22 20 C 10 22 6 38 14 46 C 8 56 14 72 28 72 C 32 84 48 86 50 76 C 52 86 68 84 72 72 C 86 72 92 56 86 46 C 94 38 90 22 78 20 C 72 8 56 8 50 18 Z',
        { weight: 'bold' },
      ),
      ink(line(50, 18, 50, 76)),
      thin(
        'M 26 34 C 32 30 38 36 42 32 M 62 32 C 68 36 74 30 78 34 M 24 56 C 30 60 36 54 42 58 M 60 58 C 66 54 72 60 78 56',
      ),
    ],
  },
  {
    id: 'battery',
    label: 'Battery, energy',
    tags: ['energy', 'power', 'tired', 'charge', 'alert'],
    strokes: [
      ink(rect(8, 30, 74, 40), { weight: 'bold' }),
      ink('M 82 42 L 92 42 L 92 58 L 82 58'),
      filled(rect(16, 38, 14, 24), 'accent2'),
      filled(rect(36, 38, 14, 24), 'accent2'),
      filled(rect(56, 38, 14, 24), 'accent2'),
    ],
  },
  {
    id: 'chart-up',
    label: 'Line chart going up',
    tags: ['growth', 'results', 'improve', 'progress', 'trend'],
    strokes: [
      ink('M 12 10 L 12 88 L 92 88'),
      accent('M 20 72 L 40 52 L 56 62 L 86 26', 'accent2', { weight: 'bold' }),
      accent('M 74 24 L 86 26 L 84 38', 'accent2', { weight: 'bold' }),
    ],
  },
  {
    id: 'bar-chart',
    label: 'Bar chart',
    tags: ['data', 'compare', 'stats', 'numbers', 'results'],
    strokes: [
      ink('M 12 10 L 12 88 L 92 88'),
      filled('M 22 88 L 22 62 L 36 62 L 36 88', 'accent1'),
      filled('M 44 88 L 44 44 L 58 44 L 58 88', 'accent1'),
      filled('M 66 88 L 66 24 L 80 24 L 80 88', 'accent1'),
    ],
  },
  {
    id: 'bed',
    label: 'Bed',
    tags: ['bed', 'sleep', 'wake up', 'morning', 'rest'],
    strokes: [
      ink('M 6 80 L 94 80 M 6 80 L 6 44 M 94 80 L 94 64'),
      ink('M 6 64 L 94 64'),
      filled('M 12 56 C 12 46 30 46 30 56 L 30 64 L 12 64 Z', 'paper'),
    ],
  },
  {
    id: 'dumbbell',
    label: 'Dumbbell, exercise',
    tags: ['exercise', 'gym', 'fitness', 'strong', 'workout', 'routine'],
    strokes: [
      bold(line(26, 50, 74, 50)),
      filled(rect(12, 28, 12, 44), 'accent1'),
      filled(rect(76, 28, 12, 44), 'accent1'),
      ink(line(6, 40, 6, 60)),
      ink(line(94, 40, 94, 60)),
    ],
  },
  {
    id: 'apple',
    label: 'Apple, healthy food',
    tags: ['food', 'healthy', 'eat', 'apple', 'diet'],
    strokes: [
      filled(
        'M 50 30 C 36 18 12 26 14 52 C 16 74 34 90 50 84 C 66 90 84 74 86 52 C 88 26 64 18 50 30 Z',
        'accent3',
      ),
      ink('M 50 30 C 50 20 54 14 60 10'),
      filled('M 56 14 C 64 8 74 10 76 16 C 68 20 60 20 56 14 Z', 'accent2'),
    ],
  },
  {
    id: 'water-glass',
    label: 'Glass of water',
    tags: ['water', 'drink', 'glass', 'health', 'hydrate'],
    strokes: [
      ink('M 22 18 L 30 88 L 70 88 L 78 18', { weight: 'bold' }),
      accent('M 26 44 C 38 38 50 50 62 44 C 68 42 72 42 75 43 L 70 88 L 30 88 Z', 'accent1', {
        fill: 'accent1',
      }),
    ],
  },
  {
    id: 'zzz',
    label: 'Zzz, sleeping',
    tags: ['sleep', 'tired', 'rest', 'night'],
    strokes: [
      ink('M 14 24 L 40 24 L 14 52 L 40 52', { weight: 'bold' }),
      ink('M 52 50 L 70 50 L 52 70 L 70 70'),
      ink('M 78 14 L 88 14 L 78 26 L 88 26', { weight: 'thin' }),
    ],
  },
  // People
  {
    id: 'person-standing',
    label: 'Stick figure standing',
    tags: ['person', 'people', 'user', 'you', 'someone'],
    strokes: person(
      line(50, 36, 32, 52),
      line(50, 36, 68, 52),
      line(50, 60, 38, 90),
      line(50, 60, 62, 90),
    ),
  },
  {
    id: 'person-celebrating',
    label: 'Stick figure with arms up, celebrating',
    tags: ['celebrate', 'happy', 'win', 'reward', 'success', 'cheer', 'energized'],
    strokes: [
      ...person(
        line(50, 36, 30, 20),
        line(50, 36, 70, 20),
        line(50, 60, 34, 90),
        line(50, 60, 66, 90),
      ),
      ink('M 14 10 L 20 16 M 86 10 L 80 16 M 8 32 L 16 32 M 92 32 L 84 32', { weight: 'thin' }),
    ],
  },
  {
    id: 'person-thinking',
    label: 'Stick figure with a hand on the chin, thinking',
    tags: ['think', 'wonder', 'decide', 'consider', 'doubt'],
    strokes: person(
      'M 50 36 L 34 56',
      'M 50 36 L 62 46 L 54 28',
      line(50, 60, 38, 90),
      line(50, 60, 62, 90),
    ),
  },
  {
    id: 'person-walking',
    label: 'Stick figure walking',
    tags: ['walk', 'go', 'move', 'journey', 'step', 'start'],
    strokes: person(
      'M 50 36 L 36 54',
      'M 50 36 L 66 48',
      'M 50 60 L 38 90',
      'M 50 60 L 64 82 L 74 90',
    ),
  },
  {
    id: 'person-sitting',
    label: 'Stick figure sitting at a desk',
    tags: ['sit', 'work', 'desk', 'computer', 'office', 'routine'],
    strokes: [
      ...person('M 50 36 L 66 46 L 80 44', 'M 50 60 L 72 60 L 72 90'),
      ink('M 76 40 L 96 40 M 86 40 L 86 90', { weight: 'thin' }),
      ink('M 38 60 L 38 90', { weight: 'thin' }),
    ],
  },
  {
    id: 'person-pointing',
    label: 'Stick figure pointing',
    tags: ['point', 'show', 'explain', 'look', 'teach'],
    strokes: person('M 50 36 L 36 54', 'M 50 36 L 92 32', 'M 50 60 L 38 90', 'M 50 60 L 62 90'),
  },
];
