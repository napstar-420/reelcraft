import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { eq } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import type { Subscription } from 'rxjs';
import type { ClientToServerEvents, ServerToClientEvents } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { channel, run } from '../db/schema/index';
import { LiveEvents, type LiveEvent } from './live-events';
import { resolveSocketUser, userRoom } from './resolve-socket-user';
import { sameOriginOnly } from './same-origin';

type LiveServer = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * Pushes invalidation hints to the browser. The path lives under `/api` so
 * the SPA fallback and the global prefix never see it; engine.io answers
 * those requests at the HTTP-server level. Rooms are per user so a second
 * user never receives the first one's runs.
 */
@WebSocketGateway({ path: '/api/socket.io', serveClient: false, allowRequest: sameOriginOnly })
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(LiveGateway.name);
  /** A run's owner never changes, so it is looked up once. */
  private readonly ownerByRun = new Map<string, string>();
  private subscription?: Subscription;

  @WebSocketServer() server!: LiveServer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: LiveEvents,
  ) {}

  afterInit(): void {
    // A throw inside an RxJS subscriber is rethrown asynchronously and would
    // crash the process, so the handler never lets a rejection escape.
    this.subscription = this.events.all().subscribe((event) => {
      void this.route(event).catch((err: unknown) =>
        this.logger.warn({ err, event }, 'live event dropped'),
      );
    });
  }

  handleConnection(socket: Socket): void {
    void socket.join(userRoom(resolveSocketUser(socket.handshake)));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  async route(event: LiveEvent): Promise<void> {
    if (this.server.engine.clientsCount === 0) return;
    const owner = await this.ownerOf(event.runId);
    if (owner === undefined) return;
    const room = this.server.to(userRoom(owner));
    if (event.type === 'run') room.emit('run:updated', { runId: event.runId });
    else room.emit('stage:updated', { runId: event.runId, stageKey: event.stageKey });
  }

  private async ownerOf(runId: string): Promise<string | undefined> {
    const cached = this.ownerByRun.get(runId);
    if (cached !== undefined) return cached;
    const [row] = await this.db
      .select({ ownerId: channel.ownerId })
      .from(run)
      .innerJoin(channel, eq(run.channelId, channel.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) return undefined;
    this.ownerByRun.set(runId, row.ownerId);
    return row.ownerId;
  }
}
