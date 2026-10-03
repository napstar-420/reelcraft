import { History } from 'lucide-react';
import type { BlueprintVersionDto } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatBlueprintVersion } from '@/lib/format-blueprint-version';

/** The blueprint's saved versions, newest first. Picking one opens it
 * read-only on the canvas (`onView`); the latest is the one the canvas edits. */
export function VersionHistory({
  versions,
  currentVersionId,
  viewingVersionId,
  onView,
}: {
  versions: BlueprintVersionDto[];
  currentVersionId: string | null;
  viewingVersionId: string | null;
  onView: (version: BlueprintVersionDto | null) => void;
}) {
  if (versions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <History /> Versions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel>Saved versions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {versions.map((version) => {
          const isCurrent = version.id === currentVersionId;
          const isViewing = version.id === viewingVersionId;
          return (
            <DropdownMenuItem
              key={version.id}
              onSelect={() => onView(isCurrent ? null : version)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="flex w-full items-center gap-2">
                <span className="font-mono text-sm">{formatBlueprintVersion(version)}</span>
                {isCurrent ? <span className="text-xs text-muted-foreground">latest</span> : null}
                {isViewing ? <span className="text-xs text-primary">viewing</span> : null}
                {!version.runnable ? (
                  <span className="ml-auto text-xs text-amber-700 dark:text-amber-400">
                    not runnable
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(version.createdAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
                {' · '}
                {version.runCount ?? 0} run{version.runCount === 1 ? '' : 's'}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
