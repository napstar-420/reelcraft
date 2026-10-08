import type { ReactNode } from 'react';
import { AlertTriangle, History } from 'lucide-react';
import { Button } from '@/components/ui/button';

function Banner({
  icon,
  children,
  actions,
}: {
  icon: ReactNode;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-amber-500/10 px-4 py-2 text-sm"
    >
      {icon}
      <span className="min-w-52 flex-1">{children}</span>
      <span className="flex gap-2">{actions}</span>
    </div>
  );
}

/** Unsaved edits the server holds were made from a version that is no longer
 * the latest, so the canvas opened the latest save instead and offers them. */
export function OrphanDraftBanner({
  basedOn,
  replacesChanges,
  busy,
  onOpen,
  onDiscard,
}: {
  /** "v1.2", or null when the edits never recorded the version they came from. */
  basedOn: string | null;
  /** The canvas has changes of its own that opening the edits would replace. */
  replacesChanges: boolean;
  busy: boolean;
  onOpen: () => void;
  onDiscard: () => void;
}) {
  return (
    <Banner
      icon={<History className="size-4 shrink-0" />}
      actions={
        <>
          <Button type="button" size="sm" disabled={busy} onClick={onOpen}>
            Open them
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onDiscard}>
            Discard
          </Button>
        </>
      }
    >
      Unsaved edits based on {basedOn ?? 'an earlier version'} were found.
      {replacesChanges ? ' Opening them replaces your current changes.' : ''}
    </Banner>
  );
}

/** Another tab, or an Undo, saved a newer version since this canvas loaded.
 * Autosave is off until the user picks what happens to this canvas. */
export function SavedElsewhereBanner({
  version,
  hasEdits,
  busy,
  onLoad,
  onKeepEdits,
}: {
  /** The newer save, e.g. "v1.3". */
  version: string;
  /** The canvas has unsaved edits, made from an older version than `version`. */
  hasEdits: boolean;
  busy: boolean;
  onLoad: () => void;
  onKeepEdits: () => void;
}) {
  return (
    <Banner
      icon={<AlertTriangle className="size-4 shrink-0" />}
      actions={
        hasEdits ? (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={onKeepEdits}>
              Keep my edits
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onLoad}>
              Discard my edits
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" disabled={busy} onClick={onLoad}>
            Load {version}
          </Button>
        )
      }
    >
      This blueprint was saved elsewhere ({version}).
      {hasEdits
        ? ` Your unsaved edits are on an older version: keep them to save over ${version}, or discard them and load ${version}.`
        : ''}
    </Banner>
  );
}
