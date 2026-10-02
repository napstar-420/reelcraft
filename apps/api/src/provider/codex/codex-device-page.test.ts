import { describe, expect, it } from 'vitest';
import { enterDeviceCodeScript, isDevicePageUrl, openDevicePageScript } from './codex-device-page';

describe('codex device page scripts', () => {
  it('only accepts OpenAI sign-in pages', () => {
    expect(isDevicePageUrl('https://auth.openai.com/codex/device')).toBe(true);
    expect(isDevicePageUrl('http://auth.openai.com/codex/device')).toBe(false);
    expect(isDevicePageUrl('https://auth.openai.com.evil.example/codex/device')).toBe(false);
    expect(isDevicePageUrl('not a url')).toBe(false);
    expect(() => openDevicePageScript('https://example.com/device')).toThrow(/Not an OpenAI/);
  });

  it('injects the code as data, not code', () => {
    const script = enterDeviceCodeScript(3, "ABCD-1234'); alert(1); ('");
    expect(script).not.toContain("alert(1); ('\n");
    expect(script).toContain('browser.evaluate(3');
    expect(() => enterDeviceCodeScript(-1, 'ABCD-1234')).toThrow();
  });
});
