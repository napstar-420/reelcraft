import type { ArtifactViewDto } from '@reelcraft/shared';
import { Badge } from '@/components/ui/badge';

/** The candidates a picked `media.image` artifact was chosen from, with the
 * chosen one marked. Each opens on its own. */
export function ImageCandidatesView({
  candidates,
}: {
  candidates: NonNullable<ArtifactViewDto['candidates']>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Candidates</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {candidates.map((candidate, position) => (
          <a
            key={candidate.url}
            href={candidate.url}
            target="_blank"
            rel="noreferrer"
            className={`flex flex-col overflow-hidden rounded-md border bg-background ${
              candidate.selected ? 'ring-2 ring-primary' : ''
            }`}
          >
            <img
              src={candidate.url}
              alt={candidate.label || `Image ${position + 1}`}
              loading="lazy"
              className="aspect-square w-full bg-muted/30 object-contain"
            />
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm">
                {candidate.label || `Image ${position + 1}`}
              </span>
              {candidate.selected ? <Badge>Chosen</Badge> : null}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
