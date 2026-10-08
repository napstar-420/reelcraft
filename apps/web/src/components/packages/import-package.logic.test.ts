import { describe, expect, it } from 'vitest';
import type { PackageInspectReportDto, PackageSlot } from '@reelcraft/shared';
import { canInstall, defaultChoices, signerLabel, toBindings } from './import-package.logic';

const asset = (over: Partial<Extract<PackageSlot, { kind: 'asset' }>> = {}): PackageSlot => ({
  kind: 'asset',
  key: 'logo',
  label: 'Logo',
  required: true,
  assetKind: 'media.image',
  bundled: { name: 'Logo', kind: 'media.image', path: 'media/a.png' },
  ...over,
});
const host = (over: Partial<Extract<PackageSlot, { kind: 'character' }>> = {}): PackageSlot => ({
  kind: 'character',
  key: 'host',
  label: 'Host',
  required: false,
  bundled: null,
  ...over,
});

const report = (slots: PackageSlot[], issues: PackageInspectReportDto['issues'] = []) =>
  ({
    summary: null,
    signer: { fingerprint: null, signed: false, trusted: false, own: false },
    slots,
    requires: { capabilities: [], providers: [] },
    issues,
    installed: null,
    suggestedName: 'x',
  }) as PackageInspectReportDto;

describe('slot choices', () => {
  it('uses bundled media by default and leaves an optional unbundled character empty', () => {
    expect(defaultChoices([asset(), host(), asset({ key: 'bg', bundled: null })])).toEqual({
      logo: 'bundled',
      host: 'empty',
      bg: '',
    });
  });

  it('turns choices into bindings, skipping empty slots', () => {
    const slots = [asset(), host(), asset({ key: 'bg', bundled: null })];
    expect(toBindings(slots, { logo: 'bundled', host: 'empty', bg: 'existing:A1' })).toEqual({
      logo: 'bundled',
      bg: { existing: 'A1' },
    });
  });
});

describe('canInstall', () => {
  const base = { mode: 'new' as const, name: 'Name', runCapUsd: 5 };

  it('needs every required slot filled', () => {
    const slots = [asset({ bundled: null })];
    expect(canInstall({ ...base, report: report(slots), choices: { logo: '' } })).toBe(false);
    expect(canInstall({ ...base, report: report(slots), choices: { logo: 'existing:A' } })).toBe(
      true,
    );
  });

  it('is never possible with a blocking problem, a blank name or a negative run cap', () => {
    const slots = [asset()];
    const choices = { logo: 'bundled' };
    const blocked = report(slots, [{ severity: 'block', code: 'x', message: 'x' }]);
    expect(canInstall({ ...base, report: blocked, choices })).toBe(false);
    expect(canInstall({ ...base, report: report(slots), choices, name: '  ' })).toBe(false);
    expect(canInstall({ ...base, report: report(slots), choices, runCapUsd: -1 })).toBe(false);
    expect(canInstall({ ...base, report: report(slots), choices })).toBe(true);
  });

  it('only updates when the package allows it', () => {
    expect(canInstall({ ...base, mode: 'update', report: report([]), choices: {} })).toBe(false);
  });
});

describe('signerLabel', () => {
  const fingerprint = 'ab12cd34ef56ab78ab12cd34ef56ab78';
  it('says who signed it and whether they are known', () => {
    expect(signerLabel({ fingerprint: null, signed: false, trusted: false, own: false })).toMatch(
      /Unsigned/,
    );
    expect(signerLabel({ fingerprint, signed: true, trusted: false, own: false })).toBe(
      'local · ab12 cd34 ef56 ab78 ab12 cd34 ef56 ab78 · new author',
    );
    expect(signerLabel({ fingerprint, signed: true, trusted: true, own: false })).toMatch(
      /trusted author$/,
    );
    expect(signerLabel({ fingerprint, signed: true, trusted: true, own: true })).toMatch(
      /made on this install$/,
    );
  });
});
