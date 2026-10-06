import { useState } from 'react';
import { ChevronDown, CircleCheck, Lock, RotateCcw, Save } from 'lucide-react';
import type { BlueprintVersionDto, VersionBump } from '@reelcraft/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatBlueprintVersion } from '@/lib/format-blueprint-version';
import { ExportPackageDialog } from '@/components/packages/export-package-dialog';
import { VersionHistory } from './version-history';

type Version = { major: number; minor: number };

/** The canvas's top bar: what this blueprint is and whether it's safe to run,
 * then Versions, Discard, Save and Run. State that used to be scattered over
 * the page (unsaved changes, runnable, the Save & run card) lives here. */
export function CanvasToolbar({
  blueprintName,
  channelName,
  latestSaved,
  versions,
  viewing,
  isDirty,
  savePending,
  runnable,
  validationFailed,
  problemCount,
  onViewVersion,
  onSave,
  onDiscard,
  runButton,
  runBlockedReason,
}: {
  blueprintName: string | undefined;
  channelName: string | undefined;
  latestSaved: (Version & { id: string }) | null;
  versions: BlueprintVersionDto[];
  /** An older saved version open read-only, or null on the working canvas. */
  viewing: BlueprintVersionDto | null;
  isDirty: boolean;
  savePending: boolean;
  runnable: boolean | undefined;
  validationFailed: boolean;
  problemCount: number;
  onViewVersion: (version: BlueprintVersionDto | null) => void;
  onSave: (bump: VersionBump) => void;
  onDiscard: () => void;
  /** The `RunLaunchDialog`, already wired to the page. */
  runButton: React.ReactNode;
  /** Why Run is off, shown on hover; null when it is on. */
  runBlockedReason: string | null;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const readOnly = viewing !== null;
  const nextMajor = latestSaved
    ? formatBlueprintVersion({ major: latestSaved.major + 1, minor: 0 })
    : null;

  return (
    <div className="relative z-30 flex min-h-[60px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background px-4 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          {channelName && (
            <p className="truncate text-[11px] leading-none text-muted-foreground">{channelName}</p>
          )}
          <h1 className="truncate text-base leading-tight font-semibold tracking-tight">
            {blueprintName ?? 'Blueprint canvas'}
          </h1>
        </div>
        {latestSaved && (
          <Badge variant="secondary" className="font-mono">
            {formatBlueprintVersion(latestSaved)}
          </Badge>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {readOnly ? (
            <Badge variant="outline" className="gap-1.5 text-primary">
              <Lock className="size-3" />
              Viewing {formatBlueprintVersion(viewing)} · read-only
            </Badge>
          ) : (
            <>
              {isDirty ? (
                <StatusBadge tone="warning" label="Unsaved changes" />
              ) : (
                <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                  <CircleCheck className="size-3" />
                  All changes saved
                </Badge>
              )}
              {validationFailed ? (
                <StatusBadge tone="warning" label="Couldn't validate, check your connection" />
              ) : (
                runnable !== undefined && (
                  <StatusBadge
                    tone={runnable ? 'success' : 'error'}
                    label={
                      runnable
                        ? problemCount > 0
                          ? `Runnable · ${problemCount} warning${problemCount === 1 ? '' : 's'}`
                          : 'Runnable'
                        : problemCount > 0
                          ? `Not runnable yet · ${problemCount} problem${problemCount === 1 ? '' : 's'}`
                          : 'Not runnable yet'
                    }
                  />
                )
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 max-md:w-full max-md:overflow-x-auto">
        <VersionHistory
          versions={versions}
          currentVersionId={latestSaved?.id ?? null}
          viewingVersionId={viewing?.id ?? null}
          onView={onViewVersion}
        />
        {!readOnly && isDirty && latestSaved && (
          <Button type="button" variant="ghost" onClick={onDiscard}>
            <RotateCcw />
            Discard
          </Button>
        )}
        {!readOnly && (
          <div className="flex">
            <Button
              type="button"
              variant={isDirty ? 'default' : 'outline'}
              className="rounded-r-none"
              onClick={() => onSave('minor')}
              disabled={savePending || !isDirty}
            >
              <Save />
              {savePending ? 'Saving…' : 'Save'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant={isDirty ? 'default' : 'outline'}
                  size="icon"
                  className="w-7 rounded-l-none border-l border-l-foreground/10"
                  aria-label="More save options"
                  disabled={savePending}
                >
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem disabled={!isDirty} onSelect={() => onSave('minor')}>
                  <span className="flex flex-col">
                    Save
                    <span className="text-xs text-muted-foreground">
                      Creates a new minor version
                    </span>
                  </span>
                </DropdownMenuItem>
                {nextMajor && (
                  <DropdownMenuItem onSelect={() => onSave('major')}>
                    <span className="flex flex-col">
                      Bump to {nextMajor}
                      <span className="text-xs text-muted-foreground">
                        Save the current canvas as a new major version
                      </span>
                    </span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!latestSaved} onSelect={() => setExportOpen(true)}>
                  <span className="flex flex-col">
                    Export package…
                    <span className="text-xs text-muted-foreground">
                      Share the latest saved version as a signed file
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {!readOnly && (
          <span title={runBlockedReason ?? 'Run the latest saved version'}>{runButton}</span>
        )}
      </div>
      <ExportPackageDialog
        versionId={latestSaved?.id ?? null}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
    </div>
  );
}
