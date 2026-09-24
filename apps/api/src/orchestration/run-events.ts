import { Injectable } from '@nestjs/common';
import { Subject, filter, type Observable } from 'rxjs';
import type { RunState } from '@reelcraft/shared';

export interface RunEvent {
  runId: string;
  type: 'state_changed' | 'stage_changed';
  state?: RunState;
  stageKey?: string;
}

/**
 * §21.2 — in-process RxJS subject backing SSE in phase 1. The Postgres
 * LISTEN/NOTIFY swap (needed once there is more than one API process) is a
 * single implementation change behind this same interface.
 */
export interface RunEvents {
  publish(event: RunEvent): void;
  stream(runId: string): Observable<RunEvent>;
}

@Injectable()
export class InProcessRunEvents implements RunEvents {
  private readonly subject = new Subject<RunEvent>();

  publish(event: RunEvent): void {
    this.subject.next(event);
  }

  stream(runId: string): Observable<RunEvent> {
    return this.subject.asObservable().pipe(filter((e) => e.runId === runId));
  }
}
