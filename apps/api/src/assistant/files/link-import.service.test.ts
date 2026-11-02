import { rmSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkImportService, ytDlpError } from './link-import.service';

const PUBLIC = async () => ['93.184.216.34'];

function service() {
  const storage = { put: vi.fn(async () => ({ key: 'k', etag: 'e', bytes: 3 })) };
  const attachments = {
    store: vi.fn(async (input: Record<string, unknown>) => ({ id: 'att1', ...input })),
  };
  const svc = new LinkImportService(storage as never, attachments as never);
  return { svc, storage, attachments };
}

const response = (status: number, headers: Record<string, string>, body = 'abc') =>
  new Response(status >= 300 && status < 400 ? null : body, { status, headers });

describe('LinkImportService', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('downloads a direct file link into the chat, following a safe redirect', async () => {
    const { svc, attachments } = service();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: '/files/clip.mp4' }))
      .mockResolvedValueOnce(response(200, { 'content-type': 'video/mp4' }));
    svc.useForTests({ fetch: fetchFn as never, resolve: PUBLIC });
    await svc.import({ ownerId: 'local', sessionId: 's1', url: 'https://cdn.example/x' });
    expect(fetchFn.mock.calls[1]![0]).toBe('https://cdn.example/files/clip.mp4');
    expect(attachments.store).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'clip.mp4',
        mime: 'video/mp4',
        bytes: 3,
        source: 'link',
        sourceUrl: 'https://cdn.example/x',
        sessionId: 's1',
      }),
    );
  });

  it('refuses private addresses, including through a redirect', async () => {
    const { svc } = service();
    svc.useForTests({
      resolve: async (host) => (host === 'inside.example' ? ['10.0.0.2'] : ['93.184.216.34']),
      fetch: vi
        .fn()
        .mockResolvedValue(response(302, { location: 'https://inside.example/a' })) as never,
    });
    await expect(
      svc.import({ ownerId: 'local', sessionId: 's1', url: 'http://127.0.0.1:9000/bucket' }),
    ).rejects.toThrow(/local network/);
    await expect(
      svc.import({ ownerId: 'local', sessionId: 's1', url: 'https://cdn.example/a' }),
    ).rejects.toThrow(/redirects somewhere not allowed/);
  });

  it('hands a web page to yt-dlp, and names the file after the video', async () => {
    const { svc, attachments } = service();
    const ytDlp = vi.fn(async (args: string[]) => {
      if (args[0] === '--version') return { stdout: '2026.08.19' };
      const out = args[args.indexOf('-o') + 1]!.replace('%(ext)s', 'mp4');
      dirs.push(out);
      writeFileSync(out, 'video');
      return { stdout: `${JSON.stringify({ title: 'Otters: a/b story' })}\n` };
    });
    svc.useForTests({
      resolve: PUBLIC,
      fetch: vi.fn().mockResolvedValue(response(200, { 'content-type': 'text/html' })) as never,
      ytDlp,
    });
    await svc.import({ ownerId: 'local', sessionId: 's1', url: 'https://video.example/watch?v=1' });
    const args = ytDlp.mock.calls[1]![0];
    expect(args).toEqual(
      expect.arrayContaining([
        '--no-playlist',
        '--ignore-config',
        '--',
        'https://video.example/watch?v=1',
      ]),
    );
    expect(args[args.indexOf('--match-filter') + 1]).toBe('duration <= 900 & !is_live');
    expect(attachments.store).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Otters  a b story.mp4', mime: 'video/mp4', bytes: 5 }),
    );
  });

  it('says so when a page link needs yt-dlp and it is missing, and reports its errors', async () => {
    const { svc } = service();
    svc.useForTests({
      resolve: PUBLIC,
      fetch: vi.fn().mockResolvedValue(response(200, { 'content-type': 'text/html' })) as never,
      ytDlp: vi.fn().mockRejectedValue(new Error('ENOENT')),
    });
    await expect(
      svc.import({ ownerId: 'local', sessionId: 's1', url: 'https://video.example/watch' }),
    ).rejects.toThrow(/yt-dlp .* is not installed/);
    expect(ytDlpError({ stderr: 'WARNING: x\nERROR: [youtube] abc: Private video' })).toBe(
      'The video could not be downloaded: [youtube] abc: Private video',
    );
    expect(ytDlpError({ killed: true })).toMatch(/longer than 10 minutes/);
  });

  it('refuses a file larger than 1 GB from its declared length', async () => {
    const { svc } = service();
    svc.useForTests({
      resolve: PUBLIC,
      fetch: vi
        .fn()
        .mockResolvedValue(
          response(200, { 'content-type': 'video/mp4', 'content-length': String(2 * 1024 ** 3) }),
        ) as never,
    });
    await expect(
      svc.import({ ownerId: 'local', sessionId: 's1', url: 'https://cdn.example/big.mp4' }),
    ).rejects.toThrow(/larger than 1 GB/);
  });
});
