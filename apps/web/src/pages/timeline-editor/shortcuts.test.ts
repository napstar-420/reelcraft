import { describe, expect, it } from 'vitest';
import { shortcutFor, type KeyInfo } from './shortcuts';
import { formatDuration, formatTimecode, rulerStepSec } from './format-time';

const key = (k: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
});

describe('shortcutFor', () => {
  it('maps the editing keys', () => {
    expect(shortcutFor(key(' '))).toBe('play_pause');
    expect(shortcutFor(key('s'))).toBe('split');
    expect(shortcutFor(key('S'))).toBe('split');
    expect(shortcutFor(key('Delete'))).toBe('delete');
    expect(shortcutFor(key('Backspace', { shiftKey: true }))).toBe('ripple_delete');
    expect(shortcutFor(key('ArrowLeft'))).toBe('frame_back');
    expect(shortcutFor(key('ArrowRight', { shiftKey: true }))).toBe('second_forward');
    expect(shortcutFor(key('Escape'))).toBe('deselect');
    expect(shortcutFor(key('='))).toBe('zoom_in');
    expect(shortcutFor(key('-'))).toBe('zoom_out');
  });

  it('treats ⌘ and Ctrl alike for undo and redo', () => {
    expect(shortcutFor(key('z', { metaKey: true }))).toBe('undo');
    expect(shortcutFor(key('z', { ctrlKey: true }))).toBe('undo');
    expect(shortcutFor(key('z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutFor(key('y', { ctrlKey: true }))).toBe('redo');
  });

  it('leaves browser and other combinations alone', () => {
    expect(shortcutFor(key('s', { metaKey: true }))).toBeUndefined();
    expect(shortcutFor(key('r', { metaKey: true }))).toBeUndefined();
    expect(shortcutFor(key('s', { altKey: true }))).toBeUndefined();
    expect(shortcutFor(key('q'))).toBeUndefined();
  });
});

describe('time formatting', () => {
  it('shows minutes, seconds and the frame', () => {
    expect(formatTimecode(0, 30)).toBe('0:00.00');
    expect(formatTimecode(67.7, 30)).toBe('1:07.21');
    expect(formatTimecode(1.999, 30)).toBe('0:01.29');
  });

  it('formats clip lengths', () => {
    expect(formatDuration(3.84)).toBe('3.8s');
    expect(formatDuration(77)).toBe('1:17');
  });

  it('spaces the ruler by zoom', () => {
    expect(rulerStepSec(200)).toBe(0.5);
    expect(rulerStepSec(40)).toBe(5);
    expect(rulerStepSec(4)).toBe(30);
  });
});
