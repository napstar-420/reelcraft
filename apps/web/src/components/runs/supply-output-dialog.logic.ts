import type { AssetKind, OutputDef } from '@reelcraft/shared';

/** What the Replace output dialog collects for a stage's declared output. */
export type SupplyInputKind =
  | { type: 'text' }
  | { type: 'data' }
  | { type: 'timeline' }
  | { type: 'files'; assetKind: AssetKind; many: boolean };

/** The kind of input an output takes, or null when it can't be supplied here (subtitles have no
 * Library kind, so they come from the assistant). */
export function supplyInputKind(output: OutputDef | null | undefined): SupplyInputKind | null {
  switch (output?.kind) {
    case 'text':
      return { type: 'text' };
    case 'data':
      return { type: 'data' };
    case 'timeline':
      return { type: 'timeline' };
    case 'media.image':
      return { type: 'files', assetKind: 'media.image', many: false };
    case 'media.image_list':
      return { type: 'files', assetKind: 'media.image', many: true };
    case 'media.video':
      return { type: 'files', assetKind: 'media.video', many: false };
    case 'media.video_list':
      return { type: 'files', assetKind: 'media.video', many: true };
    case 'media.audio':
      return { type: 'files', assetKind: 'media.audio', many: false };
    case 'media.model':
      return { type: 'files', assetKind: 'model', many: false };
    default:
      return null;
  }
}

/** The line that says what supplying changes, shown in the confirmation. */
export function supplyWarnings(args: { iterating: boolean; skipValidation: boolean }): string[] {
  return [
    ...(args.skipValidation
      ? ['Its checks and quality review are skipped: nothing judges this output.']
      : []),
    ...(args.iterating
      ? ['Later items that read the previous item are made out of date and generated again.']
      : []),
  ];
}
