/** A turn's time limit that stops counting while the turn waits for the user (an approval card),
 * so a slow answer doesn't eat into the time the model has to work. */
export class TurnTimer {
  private remaining: number;
  private startedAt = 0;
  private handle: ReturnType<typeof setTimeout> | undefined;
  private paused = 0;
  private stopped = false;

  constructor(
    limitMs: number,
    private readonly onTimeout: () => void,
  ) {
    this.remaining = limitMs;
    this.run();
  }

  /** Nested pauses (two cards at once) resume only when the last one ends. */
  pause(): void {
    if (this.stopped || this.paused++ > 0) return;
    clearTimeout(this.handle);
    this.remaining -= Date.now() - this.startedAt;
  }

  resume(): void {
    if (this.stopped || this.paused === 0 || --this.paused > 0) return;
    this.run();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.handle);
  }

  private run(): void {
    this.startedAt = Date.now();
    this.handle = setTimeout(
      () => {
        if (!this.stopped) this.onTimeout();
      },
      Math.max(0, this.remaining),
    );
  }
}
