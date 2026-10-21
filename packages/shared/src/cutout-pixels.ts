/**
 * Cutting a picture out of a plain background, on raw RGBA pixels. Pure, so it can be tested
 * without files: the same pixels in always give the same pixels out.
 */

export type Rgb = [number, number, number];

/**
 * The background colour: the most common colour along the picture's border (colours within a
 * small step count as one), averaged. A thin dark edge or something touching the border doesn't
 * change it, as long as most of the border is background.
 */
export function borderColor(rgba: Uint8Array, width: number, height: number): Rgb {
  const groups = new Map<number, { count: number; sum: [number, number, number] }>();
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const group = groups.get(key) ?? { count: 0, sum: [0, 0, 0] };
    group.count += 1;
    group.sum[0] += r;
    group.sum[1] += g;
    group.sum[2] += b;
    groups.set(key, group);
  };
  for (let x = 0; x < width; x += 1) {
    add(x, 0);
    if (height > 1) add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    add(0, y);
    if (width > 1) add(width - 1, y);
  }
  let best = { count: 0, sum: [0, 0, 0] as [number, number, number] };
  // Ties go to the smallest key, so the result never depends on the order pixels came in.
  for (const [, group] of [...groups].sort((a, b) => a[0] - b[0])) {
    if (group.count > best.count) best = group;
  }
  const mean = (total: number) => Math.round(total / Math.max(1, best.count));
  return [mean(best.sum[0]), mean(best.sum[1]), mean(best.sum[2])];
}

/** How far a pixel is from a colour, from 0 (the same) to 1 (black against white). */
function distance(rgba: Uint8Array, i: number, color: Rgb): number {
  return (
    Math.max(
      Math.abs(rgba[i]! - color[0]),
      Math.abs(rgba[i + 1]! - color[1]),
      Math.abs(rgba[i + 2]! - color[2]),
    ) / 255
  );
}

/**
 * The background: every pixel close to `color` (within `tolerance`) that joins the border through
 * other such pixels. A patch of the same colour inside the subject (the white of an eye, say) is
 * not reached, so it stays. 1 marks background.
 */
export function backgroundMask(
  rgba: Uint8Array,
  width: number,
  height: number,
  color: Rgb,
  tolerance: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const visit = (p: number) => {
    if (mask[p] || distance(rgba, p * 4, color) > tolerance) return;
    mask[p] = 1;
    queue[tail++] = p;
  };
  for (let x = 0; x < width; x += 1) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % width;
    if (x > 0) visit(p - 1);
    if (x < width - 1) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p < width * (height - 1)) visit(p + width);
  }
  return mask;
}

/**
 * The picture with its background made see-through. Within `feather` pixels of the background the
 * subject fades in, so its edge isn't jagged. Returns the new pixels and the share removed.
 */
export function cutOut(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: { tolerance: number; feather: number },
): { rgba: Uint8Array; removed: number } {
  const color = borderColor(rgba, width, height);
  const mask = backgroundMask(rgba, width, height, color, options.tolerance);
  const out = new Uint8Array(rgba);
  const feather = Math.max(0, Math.round(options.feather));
  let removed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (mask[p]) {
        out[p * 4 + 3] = 0;
        removed += 1;
        continue;
      }
      if (!feather) continue;
      // The distance to the nearest background pixel, up to the feather.
      let nearest = feather + 1;
      for (let dy = -feather; dy <= feather; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -feather; dx <= feather; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || !mask[yy * width + xx]) continue;
          nearest = Math.min(nearest, Math.max(Math.abs(dx), Math.abs(dy)));
        }
      }
      if (nearest <= feather) {
        out[p * 4 + 3] = Math.round((out[p * 4 + 3]! * nearest) / (feather + 1));
      }
    }
  }
  return { rgba: out, removed: removed / (width * height) };
}
