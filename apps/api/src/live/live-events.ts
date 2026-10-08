import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

export type LiveEvent =
  { type: 'run'; runId: string } | { type: 'stage'; runId: string; stageKey: string };

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
