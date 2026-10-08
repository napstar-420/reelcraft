import type { StageReviewDto } from '@reelcraft/shared';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { heldReasonLabel } from '@/pages/approval-review.logic';
import { ArtifactPreview } from './artifact-preview';

type ReviewItem = StageReviewDto['items'][number];

/** Every item of an iterating stage, for the one review at its end. The items
 * QC did not pass or judge come first. */
export function StageReviewGallery({ items }: { items: ReviewItem[] }) {
  const unjudged = items.filter((item) => item.attempt?.qcUnavailable);
  return (
    <div className="flex flex-col gap-4 py-4">
      {unjudged.length > 0 ? (
        <Alert>
          <AlertCircle />
          <AlertTitle>Quality control could not run on {unjudged.length} of these</AlertTitle>
          <AlertDescription>
            Retry QC once the judge is back, approve them as they are, or reject the stage.
          </AlertDescription>
        </Alert>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.itemIndex} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Item {item.itemIndex + 1}</span>
              {item.held ? (
                <Badge variant="outline">{heldReasonLabel(item.heldReason)}</Badge>
              ) : null}
            </div>
            <ArtifactPreview artifact={item.artifact} />
            <QcNote item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function QcNote({ item }: { item: ReviewItem }) {
  if (item.attempt?.qcUnavailable) {
    return <p className="text-xs text-muted-foreground">{item.attempt.qcUnavailable}</p>;
  }
  const verdict = item.attempt?.qcVerdict as { critique?: string } | null | undefined;
  if (item.held && verdict?.critique) {
    return <p className="text-xs text-muted-foreground">{verdict.critique}</p>;
  }
  return null;
}
