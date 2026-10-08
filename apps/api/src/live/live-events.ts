import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import type { AssistantStreamEvent, NotificationDto } from '@reelcraft/shared';

export type LiveEvent =
  | { type: 'run'; runId: string }
  | { type: 'stage'; runId: string; stageKey: string }
  /** A notification row was committed for this user. */
  | { type: 'notification'; recipientId: string; notification: NotificationDto }
  /** Read state changed; other tabs refetch the list. */
  | { type: 'notifications'; recipientId: string }
  /** A chat's item, streamed text or state changed. */
  | { type: 'assistant'; sessionId: string; event: AssistantStreamEvent };

/**
 * §21.2 — in-process RxJS subject that feeds the Socket.IO gateway. Services
 * publish here after their transaction commits and never talk to the gateway
 * directly (it only exists on a real HTTP server). With more than one API
 * replica, fan-out needs `@socket.io/postgres-adapter` on the gateway's
 * server; this bus stays correct per replica.
 */
@Injectable()
export class LiveEvents {
  private readonly subject = new Subject<LiveEvent>();

  publish(event: LiveEvent): void {
    this.subject.next(event);
  }

  all(): Observable<LiveEvent> {
    return this.subject.asObservable();
  }
}
