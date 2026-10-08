import type { StageReviewDto } from '@reelcraft/shared';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { heldReasonLabel } from '@/pages/approval-review.logic';
import { ArtifactPreview } from './artifact-preview';

type ReviewItem = StageReviewDto['items'][number];

/** Every item of an iterating stage, for the one review at its end. The items
 * QC did not pass or judge come first. */
export function StageReviewGallery({
  items,
  selected,
  onSelect,
  disabled,
}: {
  items: ReviewItem[];
  /** Items ticked for rejection, with the note written for each. */
  selected: Record<number, string>;
  onSelect: (itemIndex: number, note: string | null) => void;
  disabled: boolean;
}) {
  const unjudged = items.filter((item) => item.attempt?.qcUnavailable);
  return (
    <div className="flex flex-col gap-4 py-4">
      {unjudged.length > 0 ? (
        <Alert>
          <AlertCircle />
          <AlertTitle>Quality control could not run on {unjudged.length} of these</AlertTitle>
          <AlertDescription>
            Retry QC once the judge is back, approve them as they are, or reject the stage or only
            some of its items.
          </AlertDescription>
        </Alert>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.itemIndex} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={item.itemIndex in selected}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onSelect(
                      item.itemIndex,
                      checked === true ? (selected[item.itemIndex] ?? '') : null,
                    )
                  }
                  aria-label={`Reject item ${item.itemIndex + 1}`}
                />
                Item {item.itemIndex + 1}
              </label>
              {item.held ? (
                <Badge variant="outline">{heldReasonLabel(item.heldReason)}</Badge>
              ) : null}
            </div>
            <ArtifactPreview artifact={item.artifact} />
            <QcNote item={item} />
            {item.itemIndex in selected ? (
              <Textarea
                value={selected[item.itemIndex] ?? ''}
                disabled={disabled}
                onChange={(event) => onSelect(item.itemIndex, event.target.value)}
                placeholder={`What should change in item ${item.itemIndex + 1}? (optional)`}
                aria-label={`Rejection note for item ${item.itemIndex + 1}`}
              />
            ) : null}
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
