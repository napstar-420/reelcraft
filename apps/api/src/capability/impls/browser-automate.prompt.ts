import type { JsonSchema, OutputKind } from '@reelcraft/shared';

/** Output kinds a browser stage can return besides `data`: the files the
 * agent downloaded, stored as real artifacts. */
export const BROWSER_MEDIA_OUTPUTS = [
  'media.audio',
  'media.image',
  'media.video',
  'media.image_list',
  'media.video_list',
] as const satisfies readonly OutputKind[];

export type BrowserMediaOutput = (typeof BROWSER_MEDIA_OUTPUTS)[number];

export function isBrowserMediaOutput(kind: string): kind is BrowserMediaOutput {
  return (BROWSER_MEDIA_OUTPUTS as readonly string[]).includes(kind);
}

/** The MIME family a download must belong to for each output kind. */
export const DOWNLOAD_MIME_PREFIX: Record<BrowserMediaOutput, string> = {
  'media.audio': 'audio/',
  'media.image': 'image/',
  'media.video': 'video/',
  'media.image_list': 'image/',
  'media.video_list': 'video/',
};

export const DEFAULT_MAX_FILES = 10;
export const MAX_FILES_LIMIT = 50;

/** What the agent returns when the stage downloads files. Every field is
 * required (unused ones are empty strings), like Flow's manifest. */
export interface DownloadResult {
  status: 'completed' | 'error';
  errorCode: string;
  errorMessage: string;
  files: Array<{
    filename: string;
    label: string;
    sourceUrl: string;
    pageUrl: string;
    license: string;
    author: string;
  }>;
}

export const DOWNLOAD_RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['completed', 'error'] },
    errorCode: { type: 'string' },
    errorMessage: { type: 'string' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'The file name under outputs/' },
          label: { type: 'string', description: 'A short name for the file' },
          sourceUrl: { type: 'string', description: 'Where the file itself was downloaded from' },
          pageUrl: { type: 'string', description: 'The page it was found on' },
          license: { type: 'string', description: 'The licence the page states, in its own words' },
          author: { type: 'string', description: 'The creator to credit, or ""' },
        },
        required: ['filename', 'label', 'sourceUrl', 'pageUrl', 'license', 'author'],
      },
    },
  },
  required: ['status', 'errorCode', 'errorMessage', 'files'],
};

const KIND_WORDS: Record<BrowserMediaOutput, { noun: string; example: string }> = {
  'media.audio': { noun: 'an audio file', example: 'sound.mp3' },
  'media.image': { noun: 'an image', example: 'image.png' },
  'media.video': { noun: 'a video file', example: 'clip.mp4' },
  'media.image_list': { noun: 'images', example: '001.png' },
  'media.video_list': { noun: 'video files', example: '001.mp4' },
};

/** The part of the system prompt a browser stage adds when its output is
 * downloaded files, so the agent knows how to hand them over. */
export function buildDownloadSystemPrompt(kind: BrowserMediaOutput, maxFiles: number): string {
  const { noun, example } = KIND_WORDS[kind];
  const single = !kind.endsWith('_list');
  const count = single
    ? `exactly one file: ${noun}`
    : `up to ${maxFiles} files: ${noun}, in the order the user prompt asks for them`;
  return `The user prompt says what to find. This message says how to hand it back.

Downloading
1. Find ${count}, in the signed-in browser. If the browser shows a sign-in page, stop and report it instead of entering credentials. Never pay, subscribe or accept a purchase.
2. Prefer sites whose files are free to use and say so on the page (for example public-domain or Creative Commons 0 files, or a site's free licence). Read the licence the page states and do not use a file that is not free to use for video.
3. Download each file and save it under "outputs/" with a short plain file name such as "${example}". The file must be the real media file, not a web page or a preview that needs a player.
4. Check what you saved: the type is right and it is not empty.

Result
- Return the supplied JSON manifest. status is "completed" when every file is downloaded and "error" otherwise. Unused fields are "" (or an empty list).
- files lists every downloaded file: its file name under outputs/, a short label, the address it was downloaded from (sourceUrl), the page it was found on (pageUrl), the licence the page states in its own words, and the author to credit ("" if none).
- Attach every downloaded file in the manifest's attachments (role "download", with its real MIME type and the same file name). A screenshot of the page showing the licence may be attached as evidence.
- If you cannot find a suitable file, or the licence is not clear, do not guess and do not return a file. Return status "error" with an errorCode (input_missing, input_mismatch, task_impossible or refused) and an errorMessage of one or two sentences naming the problem.
- Use BrowserOS Neo only, and work only in tabs you opened.`;
}
