import { request } from 'node:http';
import { Injectable } from '@nestjs/common';
import type { UpdateStatusDto } from '@reelcraft/shared';
import { EngineConfig } from '../config/engine-config';

/** The agent's own status: everything in UpdateStatusDto that the API does
 * not add itself. */
export type AgentStatus = Omit<UpdateStatusDto, 'managed' | 'activeRuns'>;

/** The agent refused a request (for example, an update already running). */
export class UpdateAgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const UNREACHABLE = new Set(['ENOENT', 'ECONNREFUSED', 'EACCES']);

/** Talks to the self-hosted image's root-owned update agent over its Unix
 * socket (docker/app/rootfs/usr/local/lib/reelcraft/updater/agent.mjs).
 * Returns null when no agent is running, as in local development. */
@Injectable()
export class UpdateAgentClient {
  constructor(private readonly config: EngineConfig) {}

  status(): Promise<AgentStatus | null> {
    return this.call('GET', '/status');
  }

  check(): Promise<AgentStatus | null> {
    return this.call('POST', '/check');
  }

  install(version: string): Promise<AgentStatus | null> {
    return this.call('POST', '/install', { version });
  }

  private call(method: string, path: string, body?: unknown): Promise<AgentStatus | null> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.config.updaterSocket,
          method,
          path,
          headers: payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {},
          // A check waits on GitHub; everything else answers at once.
          timeout: 60_000,
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (raw += chunk));
          res.on('end', () => {
            let parsed: unknown;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch {
              return reject(new Error(`update agent sent invalid JSON (HTTP ${res.statusCode})`));
            }
            const status = res.statusCode ?? 500;
            if (status >= 400) {
              const message = (parsed as { message?: unknown } | null)?.message;
              return reject(
                new UpdateAgentError(
                  typeof message === 'string' ? message : `update agent error ${status}`,
                  status,
                ),
              );
            }
            resolve(parsed as AgentStatus);
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('update agent timed out')));
      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code && UNREACHABLE.has(err.code)) resolve(null);
        else reject(err);
      });
      req.end(payload);
    });
  }
}
