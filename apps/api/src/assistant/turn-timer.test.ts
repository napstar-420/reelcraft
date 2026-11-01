import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnTimer } from './turn-timer';

describe('TurnTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after the limit', () => {
    const onTimeout = vi.fn();
    new TurnTimer(1000, onTimeout);
    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not count the time spent paused, and nested pauses resume once', () => {
    const onTimeout = vi.fn();
    const timer = new TurnTimer(1000, onTimeout);
    vi.advanceTimersByTime(600);
    timer.pause();
    timer.pause();
    vi.advanceTimersByTime(10_000);
    timer.resume();
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
    timer.resume();
    vi.advanceTimersByTime(399);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('never fires once stopped', () => {
    const onTimeout = vi.fn();
    const timer = new TurnTimer(1000, onTimeout);
    timer.stop();
    timer.resume();
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
