import { execFile } from 'node:child_process';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, blob } from '../db/schema/index';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { DerivedFrameService, type DerivedFrameKind } from './derived-frame.service';

/** A picture for the blueprint assistant to look at. */
export interface PreviewImage {
  mime: 'image/jpeg' | 'image/png';
  base64: string;
  /** What it shows, for the model: "item 2", "first frame"… */
  label: string;
}

/** Longest side of a picture sent to the model, in pixels. */
const MAX_EDGE = 1024;
/** A source image bigger than this is never read. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/** Without ffmpeg an already-small picture is sent as it is; anything larger is skipped. */
const MAX_UNSCALED_BYTES = 1_500_000;

/** Frames shown for a video: the first, one a third in, and the last. */
const VIDEO_FRAMES: Array<{ which: DerivedFrameKind; label: string }> = [
  { which: 'firstFrame', label: 'first frame' },
  { which: 'poster', label: 'a third of the way in' },
  { which: 'lastFrame', label: 'last frame' },
];

async function readAll(stream: Readable, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk as Buffer);
    size += buf.length;
    if (size > limit) {
      stream.destroy();
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Turns stored media into small pictures the assistant can look at: images are scaled down with
 * ffmpeg (JPEG, longest side 1024), videos give three frames through `DerivedFrameService`
 * (cached on the artifact, so a second look costs nothing). A file that can't be read or shrunk is
 * left out, never an error: the assistant still has the file's details.
 */
@Injectable()
export class MediaPreviewService {
  private readonly logger = new Logger(MediaPreviewService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly frames: DerivedFrameService,
  ) {}

  /** One picture from a stored image blob. */
  async imageFromBlob(blobId: string, label: string): Promise<PreviewImage | null> {
    const [row] = await this.db.select().from(blob).where(eq(blob.id, blobId)).limit(1);
    if (!row || row.deletedAt || row.bytes > MAX_SOURCE_BYTES) return null;
    if (!row.mime.startsWith('image/')) return null;
    const source = await readAll(await this.storage.getStream(row.objectKey), MAX_SOURCE_BYTES);
    if (!source) return null;
    try {
      const scaled = await this.scale(source);
      return { mime: 'image/jpeg', base64: scaled.toString('base64'), label };
    } catch (error) {
      this.logger.warn({ blobId, err: error }, 'could not scale an image; using it as it is');
      if (
        source.length <= MAX_UNSCALED_BYTES &&
        (row.mime === 'image/jpeg' || row.mime === 'image/png')
      ) {
        return { mime: row.mime, base64: source.toString('base64'), label };
      }
      return null;
    }
  }

  /** Three frames of a video artifact. */
  async framesOfVideo(artifactId: string): Promise<PreviewImage[]> {
    const [row] = await this.db.select().from(artifact).where(eq(artifact.id, artifactId)).limit(1);
    if (!row?.blobId) return [];
    const out: PreviewImage[] = [];
    for (const { which, label } of VIDEO_FRAMES) {
      try {
        await this.frames.extract(row, which);
        const [fresh] = await this.db
          .select({ derived: artifact.derived })
          .from(artifact)
          .where(eq(artifact.id, artifactId))
          .limit(1);
        const frameBlobId = (fresh?.derived as Record<string, string> | null)?.[which];
        const image = frameBlobId ? await this.imageFromBlob(frameBlobId, label) : null;
        if (image) out.push(image);
      } catch (error) {
        this.logger.warn({ artifactId, which, err: error }, 'could not extract a video frame');
      }
    }
    return out;
  }

  /** Scales to at most MAX_EDGE on the long side, as JPEG, with ffmpeg reading and writing pipes. */
  protected scale(input: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'ffmpeg',
        [
          '-v',
          'error',
          '-i',
          'pipe:0',
          '-frames:v',
          '1',
          '-vf',
          `scale='if(gt(iw,ih),min(${MAX_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${MAX_EDGE},ih))'`,
          '-q:v',
          '4',
          '-f',
          'mjpeg',
          'pipe:1',
        ],
        { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 20_000 },
        (error, stdout) =>
          error || !stdout.length ? reject(error ?? new Error('empty output')) : resolve(stdout),
      );
      child.stdin?.on('error', () => undefined); // ffmpeg may close early; the callback reports it
      child.stdin?.end(input);
    });
  }
}
