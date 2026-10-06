import { Injectable } from '@nestjs/common';
import { Subject, filter, map, type Observable } from 'rxjs';
import type { AssistantStreamEvent } from '@reelcraft/shared';

/** In-process bus for the chat's live updates, like `InProcessRunEvents`: one Reelcraft process,
 * no replay. A reconnecting client re-fetches the session and then listens again. */
@Injectable()
export class AssistantEvents {
  private readonly subject = new Subject<{ sessionId: string; event: AssistantStreamEvent }>();

  publish(sessionId: string, event: AssistantStreamEvent): void {
    this.subject.next({ sessionId, event });
  }

  stream(sessionId: string): Observable<AssistantStreamEvent> {
    return this.subject.pipe(
      filter((e) => e.sessionId === sessionId),
      map((e) => e.event),
    );
  }
}
