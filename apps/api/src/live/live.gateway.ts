import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { eq } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import type { Subscription } from 'rxjs';
import type { ClientToServerEvents, ServerToClientEvents } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { assistantSession, blueprint, channel, run } from '../db/schema/index';
import { LiveEvents, type LiveEvent } from './live-events';
import { assistantRoom, resolveSocketUser, userRoom } from './resolve-socket-user';
import { sameOriginOnly } from './same-origin';

type LiveServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Session ids are ULIDs; anything much longer is not one. */
const MAX_SESSION_ID = 64;

/**
 * Pushes invalidation hints to the browser. The path lives under `/api` so
 * the SPA fallback and the global prefix never see it; engine.io answers
 * those requests at the HTTP-server level. Rooms are per user so a second
 * user never receives the first one's runs.
 */
@WebSocketGateway({ path: '/api/socket.io', serveClient: false, allowRequest: sameOriginOnly })
export class LiveGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(LiveGateway.name);
  /** A run's owner never changes, so it is looked up once. */
  private readonly ownerByRun = new Map<string, string>();
  /** Latest watch/unwatch request per `socketId:sessionId`. A watch checks the
   * owner before it joins; if the socket unwatched (or watched again) while that
   * lookup ran, the older request must not join. */
  private readonly watchSeq = new Map<string, number>();
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

  handleDisconnect(socket: Socket): void {
    const prefix = `${socket.id}:`;
    for (const key of this.watchSeq.keys()) if (key.startsWith(prefix)) this.watchSeq.delete(key);
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /** A chat's events go only to sockets that asked for it, because streamed
   * text arrives token by token. The owner is checked here, once, when the
   * socket joins: whoever is in the room may read everything in it. */
  @SubscribeMessage('assistant:watch')
  async watch(
    @ConnectedSocket() socket: Socket,
    @MessageBody() sessionId: unknown,
  ): Promise<boolean> {
    if (
      typeof sessionId !== 'string' ||
      sessionId.length === 0 ||
      sessionId.length > MAX_SESSION_ID
    )
      return false;
    const key = `${socket.id}:${sessionId}`;
    const seq = this.nextSeq(key);
    const owner = await this.ownerOfSession(sessionId);
    if (owner === undefined || owner !== resolveSocketUser(socket.handshake)) return false;
    if (this.watchSeq.get(key) !== seq) return false; // unwatched or re-watched meanwhile
    await socket.join(assistantRoom(sessionId));
    return true;
  }

  @SubscribeMessage('assistant:unwatch')
  async unwatch(
    @ConnectedSocket() socket: Socket,
    @MessageBody() sessionId: unknown,
  ): Promise<void> {
    if (typeof sessionId === 'string' && sessionId.length <= MAX_SESSION_ID) {
      this.nextSeq(`${socket.id}:${sessionId}`);
      await socket.leave(assistantRoom(sessionId));
    }
  }

  async route(event: LiveEvent): Promise<void> {
    if (this.server.engine.clientsCount === 0) return;
    if (event.type === 'assistant') {
      this.server
        .to(assistantRoom(event.sessionId))
        .emit('assistant:event', { sessionId: event.sessionId, event: event.event });
      return;
    }
    if (event.type === 'notification') {
      this.server.to(userRoom(event.recipientId)).emit('notification:created', event.notification);
      return;
    }
    if (event.type === 'notifications') {
      this.server.to(userRoom(event.recipientId)).emit('notifications:changed');
      return;
    }
    const owner = await this.ownerOf(event.runId);
    if (owner === undefined) return;
    const room = this.server.to(userRoom(owner));
    if (event.type === 'run') room.emit('run:updated', { runId: event.runId });
    else room.emit('stage:updated', { runId: event.runId, stageKey: event.stageKey });
  }

  private nextSeq(key: string): number {
    const seq = (this.watchSeq.get(key) ?? 0) + 1;
    this.watchSeq.set(key, seq);
    return seq;
  }

  private async ownerOfSession(sessionId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ ownerId: channel.ownerId })
      .from(assistantSession)
      .innerJoin(blueprint, eq(assistantSession.blueprintId, blueprint.id))
      .innerJoin(channel, eq(blueprint.channelId, channel.id))
      .where(eq(assistantSession.id, sessionId))
      .limit(1);
    return row?.ownerId;
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
