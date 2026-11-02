// Copies the user guide's Markdown (apps/docs/docs) into dist/user-guide, so the API can answer
// the assistant's search_docs from the copy that ships with it (the image and the app bundle).
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const api = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(api, '..', 'docs', 'docs');
const to = join(api, 'dist', 'user-guide');

if (!existsSync(from)) {
  console.error(`copy-user-guide: ${from} is missing; the assistant's search_docs needs it`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true, filter: (src) => !/\.(png|jpe?g|gif|svg|webp)$/i.test(src) });
