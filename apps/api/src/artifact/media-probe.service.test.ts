import { describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));

function mockFfprobe(stdout: object) {
  execFileMock.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
    ) => cb(null, { stdout: JSON.stringify(stdout), stderr: '' }),
  );
}

describe('MediaProbeService.probe', () => {
  it('accepts a still image with no format.duration field', async () => {
    const { MediaProbeService } = await import('./media-probe.service');
    // Real `ffprobe` output for a 1x1 PNG — format.duration is absent, not "0".
    mockFfprobe({
      streams: [{ codec_type: 'video', codec_name: 'png', width: 1, height: 1 }],
      format: { format_name: 'png_pipe' },
    });

    const probe = await new MediaProbeService().probe('tiny.png');

    expect(probe.durationSec).toBe(0);
    expect(probe.container).toBe('png_pipe');
    expect(probe.streams).toEqual([{ type: 'video', codec: 'png', width: 1, height: 1 }]);
  });

  it('still rejects media with a negative duration', async () => {
    const { MediaProbeService } = await import('./media-probe.service');
    mockFfprobe({
      streams: [{ codec_type: 'video', codec_name: 'h264' }],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '-1' },
    });

    await expect(new MediaProbeService().probe('bad.mp4')).rejects.toThrow(
      /corrupt or duration-less media/,
    );
  });

  it('still rejects media with no format_name at all', async () => {
    const { MediaProbeService } = await import('./media-probe.service');
    mockFfprobe({ streams: [], format: {} });

    await expect(new MediaProbeService().probe('empty.bin')).rejects.toThrow(/corrupt media/);
  });
});
