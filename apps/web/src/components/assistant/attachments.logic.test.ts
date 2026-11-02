import { describe, expect, it } from 'vitest';
import { extensionOf, fileKind, formatBytes, formatDuration, refusal } from './attachments.logic';

describe('chat attachments', () => {
  it('sorts files into pictures, videos, sounds and other files', () => {
    expect(fileKind({ name: 'a.png', type: 'image/png' })).toBe('image');
    expect(fileKind({ name: 'a.svg', type: 'image/svg+xml' })).toBe('file');
    expect(fileKind({ name: 'clip.MOV', type: '' })).toBe('video');
    expect(fileKind({ name: 'voice.m4a', type: '' })).toBe('audio');
    expect(fileKind({ name: 'notes.pdf', type: 'application/pdf' })).toBe('file');
    expect(extensionOf('archive.tar.GZ')).toBe('gz');
    expect(extensionOf('README')).toBe('');
  });

  it('refuses files with no extension, empty files and files over the limit', () => {
    expect(refusal({ name: 'a.png', type: 'image/png', size: 1000 })).toBeNull();
    expect(refusal({ name: 'noext', type: '', size: 10 })).toMatch(/no file extension/);
    expect(refusal({ name: 'a.png', type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(refusal({ name: 'a.png', type: 'image/png', size: 30 * 1024 * 1024 })).toMatch(/20 MB/);
    expect(refusal({ name: 'a.mp4', type: 'video/mp4', size: 30 * 1024 * 1024 })).toBeNull();
  });

  it('formats sizes and lengths', () => {
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(null)).toBeNull();
  });
});
