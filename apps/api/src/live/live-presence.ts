import { Injectable } from '@nestjs/common';
import { assistantRoom } from './resolve-socket-user';

/** Which assistant chats an open page is watching right now. The gateway hands it the Socket.IO
 * server once it starts; before that (and in tests without one) nobody is watching. */
@Injectable()
export class LivePresence {
  private rooms: { has(room: string): boolean; get(room: string): Set<string> | undefined } | null =
    null;

  attach(rooms: { has(room: string): boolean; get(room: string): Set<string> | undefined }): void {
    this.rooms = rooms;
  }

  /** True when at least one connected page shows this chat. */
  watching(sessionId: string): boolean {
    return (this.rooms?.get(assistantRoom(sessionId))?.size ?? 0) > 0;
  }
}
