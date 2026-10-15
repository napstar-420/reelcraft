import { describe, expect, it } from 'vitest';
import { importSvg } from './svg-import';

const svg = (inner: string, attrs = 'viewBox="0 0 100 100"') =>
  `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe('importSvg', () => {
  it('reads paths with their colours and weights', () => {
    const result = importSvg(
      svg('<path d="M10 10 L90 10 L90 90 Z" stroke="#3b82f6" stroke-width="2" fill="none"/>'),
    );
    expect(result).toMatchObject({
      ok: true,
      viewBox: { width: 100, height: 100 },
      strokes: [{ d: 'M 10 10 L 90 10 L 90 90 Z', color: '#3b82f6', weight: 'normal' }],
    });
  });

  it('fills a shape that has only a fill, and black by default', () => {
    const result = importSvg(
      svg(
        '<rect x="10" y="10" width="30" height="30" fill="#ff0000"/><circle cx="70" cy="70" r="10"/>',
      ),
    );
    expect(result.ok && result.strokes.map((s) => [s.fill, s.color])).toEqual([
      ['#ff0000', undefined],
      ['#000000', undefined],
    ]);
  });

  it('turns every shape into a path', () => {
    const result = importSvg(
      svg(
        '<line x1="0" y1="0" x2="50" y2="50" stroke="black"/><polyline points="0,0 10,10 20,0" stroke="black" fill="none"/><polygon points="10,10 50,10 30,40" stroke="black" fill="none"/><ellipse cx="50" cy="50" rx="30" ry="10" stroke="black" fill="none"/>',
      ),
    );
    expect(result.ok && result.strokes).toHaveLength(4);
    expect(result.ok && result.strokes[2]!.d).toBe('M 10 10 L 50 10 L 30 40 Z');
  });

  it('bakes the transforms of groups into the lines', () => {
    const result = importSvg(
      svg(
        '<g transform="translate(20 10) scale(2)"><path d="M0 0 L10 0 L10 10" stroke="black" fill="none"/></g>',
      ),
    );
    expect(result.ok && result.strokes[0]!.d).toBe('M 20 10 L 40 10 L 40 30');
  });

  it('moves the picture to the origin and scales a big one down', () => {
    const result = importSvg(
      svg(
        '<path d="M1000 1000 L3000 1000 L3000 2000" stroke="black" fill="none"/>',
        'viewBox="1000 1000 4000 2000"',
      ),
    );
    expect(result.ok && result.viewBox).toEqual({ width: 1000, height: 500 });
    expect(result.ok && result.strokes[0]!.d).toBe('M 0 0 L 500 0 L 500 250');
  });

  it('uses the width and height when there is no viewBox, and style attributes', () => {
    const result = importSvg(
      svg(
        '<path d="M5 5 L45 45" style="stroke:#222;fill:none;stroke-width:4"/>',
        'width="50" height="50"',
      ),
    );
    expect(result).toMatchObject({ ok: true, viewBox: { width: 50, height: 50 } });
    expect(result.ok && result.strokes[0]).toMatchObject({ color: '#222', weight: 'bold' });
  });

  it('keeps arcs under a uniform transform and refuses them when stretched', () => {
    const arc = '<path d="M10 50 A 20 20 0 0 1 50 50" stroke="black" fill="none"/>';
    const ok = importSvg(svg(`<g transform="scale(2)">${arc}</g>`));
    expect(ok.ok && ok.strokes[0]!.d).toBe('M 20 100 A 40 40 0 0 1 100 100');
    expect(importSvg(svg(`<g transform="scale(2 1)">${arc}</g>`))).toMatchObject({
      ok: false,
      message: expect.stringContaining('stretched'),
    });
  });

  it('leaves out hidden shapes, definitions and what it cannot draw, and says so', () => {
    const result = importSvg(
      svg(
        '<defs><path d="M0 0 L9 9" stroke="red"/></defs><path display="none" d="M0 0 L50 50" stroke="black"/><text x="1" y="1">hi</text><path d="M10 10 L60 60" stroke="black"/>',
      ),
    );
    expect(result.ok && result.strokes).toHaveLength(1);
    expect(result.ok && result.skipped).toEqual(['text (convert it to outlines)']);
    expect(importSvg(svg('<text x="1" y="1">only text</text>'))).toMatchObject({
      ok: false,
      message: expect.stringContaining('nothing'),
    });
  });

  it('refuses scripts, foreign objects and event handlers', () => {
    for (const bad of [
      '<script>alert(1)</script><path d="M0 0 L9 9" stroke="black"/>',
      '<foreignObject><div/></foreignObject>',
      '<path d="M0 0 L9 9" stroke="black" onload="x()"/>',
      '<path d="M0 0 L9 9" stroke="javascript:alert(1)"/>',
    ]) {
      expect(importSvg(svg(bad)), bad).toMatchObject({ ok: false });
    }
  });

  it('refuses what is not an SVG, has no size, or has too many shapes', () => {
    expect(importSvg('<html></html>')).toMatchObject({ ok: false });
    expect(importSvg('<svg><path d="M0 0 L1 1" stroke="black"/></svg>')).toMatchObject({
      ok: false,
      message: expect.stringContaining('no size'),
    });
    const many = Array.from(
      { length: 61 },
      (_, i) => `<path d="M${i} 0 L${i} 50" stroke="black"/>`,
    ).join('');
    expect(importSvg(svg(many, 'viewBox="0 0 100 100"'))).toMatchObject({
      ok: false,
      message: expect.stringContaining('more than 60'),
    });
  });

  it('does not take the contents of colours it cannot trust', () => {
    const result = importSvg(
      svg(
        '<path d="M10 10 L60 60" stroke="url(#g)" fill="expression(alert(1))"/><path d="M0 0 L9 9" stroke="currentColor"/>',
      ),
    );
    // The first has neither a usable stroke nor fill (fill is unsafe text and so ignored); the second is ink.
    expect(result.ok && result.strokes.map((s) => s.color)).toContain('ink');
    expect(JSON.stringify(result)).not.toContain('expression');
  });
});
