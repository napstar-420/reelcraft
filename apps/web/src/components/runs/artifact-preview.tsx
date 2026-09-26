import type { ArtifactViewDto } from '@reelcraft/shared';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { approvalCandidateView } from '@/pages/approval-review.logic';

export function ArtifactPreview({ artifact }: { artifact: ArtifactViewDto }) {
  const view = approvalCandidateView(artifact.kind, artifact.data, artifact.previewUrl);
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border bg-muted/20">
        {view.kind === 'text' || view.kind === 'json' ? (
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words p-4 text-sm">
            {view.text}
          </pre>
        ) : view.kind === 'image' ? (
          <img src={view.url} alt="Stage output" className="max-h-[50vh] w-full object-contain" />
        ) : view.kind === 'video' ? (
          <video src={view.url} controls className="max-h-[50vh] w-full" />
        ) : view.kind === 'audio' ? (
          <audio src={view.url} controls className="m-4 w-[calc(100%-2rem)]" />
        ) : view.kind === 'download' ? (
          <Button variant="link" asChild className="m-2">
            <a href={view.url} target="_blank" rel="noreferrer">
              <Download /> Download output
            </a>
          </Button>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No inline preview is available.</p>
        )}
      </div>

      {artifact.attachments.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Attachments</h3>
          {artifact.attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
            >
              <Download className="size-4" />
              <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
              <span className="text-xs text-muted-foreground">{attachment.role}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
