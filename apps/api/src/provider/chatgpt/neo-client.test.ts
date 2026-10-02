import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NeoClient } from './neo-client';

const config = { browserOsUrl: async () => 'http://127.0.0.1:9010/mcp' };
const ok = { content: [], structuredContent: { ok: true, value: 7 } };

describe('NeoClient', () => {
  it('reconnects and replays once when Neo expired the session (404)', async () => {
    vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
    const callTool = vi
      .spyOn(Client.prototype, 'callTool')
      .mockRejectedValueOnce(new StreamableHTTPError(404, 'Session not found'))
      .mockResolvedValueOnce(ok);

    await expect(new NeoClient(config).run('x')).resolves.toBe(7);
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it('does not replay other failures', async () => {
    vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
    const callTool = vi
      .spyOn(Client.prototype, 'callTool')
      .mockRejectedValue(new StreamableHTTPError(500, 'boom'));

    await expect(new NeoClient(config).run('x')).rejects.toThrow(/unavailable/);
    expect(callTool).toHaveBeenCalledTimes(1);
  });
});
