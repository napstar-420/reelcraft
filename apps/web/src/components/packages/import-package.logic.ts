import { formatFingerprint } from '../../lib/format-fingerprint';
import type {
  InstallPackageDto,
  PackageInspectReportDto,
  PackageSignerDto,
  PackageSlot,
} from '@reelcraft/shared';

/** What the importer picked for a slot: the package's own media (`bundled`),
 * nothing (`empty`, optional slots only), `existing:<id>`, or '' for not yet. */
export type SlotChoice = string;

export const EXISTING = 'existing:';

export function defaultChoice(slot: PackageSlot): SlotChoice {
  if (slot.bundled) return 'bundled';
  return slot.kind === 'character' && !slot.required ? 'empty' : '';
}

export function defaultChoices(slots: PackageSlot[]): Record<string, SlotChoice> {
  return Object.fromEntries(slots.map((slot) => [slot.key, defaultChoice(slot)]));
}

/** The `bindings` an install request carries: only what differs from "use the
 * package's media", and nothing for an empty slot. */
export function toBindings(
  slots: PackageSlot[],
  choices: Record<string, SlotChoice>,
): InstallPackageDto['bindings'] {
  const bindings: InstallPackageDto['bindings'] = {};
  for (const slot of slots) {
    const choice = choices[slot.key] ?? '';
    if (choice === 'bundled') bindings[slot.key] = 'bundled';
    else if (choice.startsWith(EXISTING)) {
      bindings[slot.key] = { existing: choice.slice(EXISTING.length) };
    }
  }
  return bindings;
}

export function hasBlock(report: PackageInspectReportDto): boolean {
  return report.issues.some((issue) => issue.severity === 'block');
}

/** Whether every required slot is filled and the request is complete. */
export function canInstall(input: {
  report: PackageInspectReportDto;
  choices: Record<string, SlotChoice>;
  mode: 'new' | 'update';
  name: string;
  runCapUsd: number;
}): boolean {
  const { report, choices, mode, name, runCapUsd } = input;
  if (hasBlock(report) || !(runCapUsd >= 0)) return false;
  if (mode === 'new' && !name.trim()) return false;
  if (mode === 'update' && !report.installed?.canUpdate) return false;
  return report.slots.every((slot) => !slot.required || (choices[slot.key] ?? '') !== '');
}

/** Who signed it, in the words the dialog shows. */
export function signerLabel(signer: PackageSignerDto): string {
  if (!signer.signed || !signer.fingerprint) return 'Unsigned: no way to tell who made this';
  const fingerprint = `local · ${formatFingerprint(signer.fingerprint)}`;
  if (signer.own) return `${fingerprint} · made on this install`;
  return `${fingerprint} · ${signer.trusted ? 'trusted author' : 'new author'}`;
}
