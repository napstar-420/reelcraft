import type { ArtifactViewDto } from '@reelcraft/shared';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { approvalCandidateView } from '@/pages/approval-review.logic';
import { CopyButton } from './artifact-views/copy-button';
import { ClipListView } from './artifact-views/clip-list-view';
import { DataView } from './artifact-views/data-view';
import { ImageCandidatesView } from './artifact-views/image-candidates-view';
import { ImageListView } from './artifact-views/image-list-view';
import { MediaView } from './artifact-views/media-view';
import { SubtitlesView } from './artifact-views/subtitles-view';
import { TimelineView } from './artifact-views/timeline-view';
import { isTimeline } from './artifact-views/timeline-view.logic';

export function ArtifactPreview({ artifact }: { artifact: ArtifactViewDto }) {
  const view = approvalCandidateView(artifact.kind, artifact.data, artifact.previewUrl);
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border bg-muted/20">
        {artifact.kind === 'data' ? (
          <DataView data={artifact.data} />
        ) : artifact.kind === 'timeline' && isTimeline(artifact.data) ? (
          <TimelineView timeline={artifact.data} />
        ) : artifact.kind === 'media.video_list' ? (
          <ClipListView clips={artifact.clips ?? []} />
        ) : artifact.kind === 'media.image_list' ? (
          <ImageListView images={artifact.images ?? []} />
        ) : artifact.kind === 'file.subtitles' ? (
          <SubtitlesView data={artifact.data} url={artifact.previewUrl} />
        ) : view.kind === 'text' ? (
          <div>
            <div className="flex justify-end border-b px-2 py-1">
              <CopyButton text={view.text} />
            </div>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap wrap-anywhere p-4 text-sm">
              {view.text}
            </pre>
          </div>
        ) : view.kind === 'json' ? (
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap wrap-anywhere p-4 text-sm">
            {view.text}
          </pre>
        ) : view.kind === 'image' || view.kind === 'video' || view.kind === 'audio' ? (
          <MediaView artifact={artifact} url={view.url} />
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

      {artifact.candidates && artifact.candidates.length > 1 ? (
        <ImageCandidatesView candidates={artifact.candidates} />
      ) : null}

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
