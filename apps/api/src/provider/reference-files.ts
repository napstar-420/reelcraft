import { basename, extname } from 'node:path';
import type { StorageAdapter } from '../storage/storage.adapter';
import { collectSourceKeys } from './source-keys';

export type ReferenceFile = { name: string; mime: string; base64: string };

const EXTENSION_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function mimeOf(storage: StorageAdapter, key: string): Promise<string> {
  const { mime } = await storage.stat(key);
  if (mime && mime !== 'application/octet-stream') return mime;
  return EXTENSION_MIME[extname(key).toLowerCase()] ?? 'application/octet-stream';
}

/** Loads every stored file referenced in `slots` (see `collectSourceKeys`),
 * in order, as base64 — for adapters that upload files inline. */
export async function loadReferenceFiles(
  storage: StorageAdapter,
  slots: unknown,
  limits: { max: number; maxBytes: number; label: string },
): Promise<ReferenceFile[]> {
  const keys = collectSourceKeys(slots);
  if (keys.length > limits.max) {
    throw new Error(`${limits.label} accepts at most ${limits.max} attached files`);
  }
  return Promise.all(
    keys.map(async (key, index) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of await storage.getStream(key)) {
        const buffer = Buffer.from(chunk as Buffer);
        bytes += buffer.length;
        if (bytes > limits.maxBytes) {
          throw new Error(
            `Attached file "${basename(key)}" exceeds ${limits.maxBytes / (1024 * 1024)} MiB`,
          );
        }
        chunks.push(buffer);
      }
      return {
        name: `${index + 1}-${basename(key)}`,
        mime: await mimeOf(storage, key),
        base64: Buffer.concat(chunks).toString('base64'),
      };
    }),
  );
}
