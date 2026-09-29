import type { ArtifactViewDto } from '@reelcraft/shared';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { mediaFacts } from './media-view.logic';

/** An image/video/audio artifact: the media itself, then its metadata chips
 * and a download link. Images open full size in a new tab on click. */
export function MediaView({ artifact, url }: { artifact: ArtifactViewDto; url: string }) {
  const facts = mediaFacts(artifact.kind, artifact.probe);

  return (
    <div>
      {artifact.kind === 'media.image' ? (
        <a href={url} target="_blank" rel="noreferrer" title="Open full size">
          <img
            src={url}
            alt="Stage output"
            className="max-h-[50vh] w-full cursor-zoom-in object-contain"
          />
        </a>
      ) : artifact.kind === 'media.video' ? (
        <video src={url} controls className="max-h-[50vh] w-full bg-black" />
      ) : (
        <audio src={url} controls className="m-4 w-[calc(100%-2rem)]" />
      )}
      <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
        {facts.map((fact) => (
          <Badge key={fact} variant="outline" className="font-normal">
            {fact}
          </Badge>
        ))}
        <Button variant="ghost" size="sm" asChild className="ml-auto">
          <a href={url} target="_blank" rel="noreferrer" download>
            <Download /> Download
          </a>
        </Button>
      </div>
    </div>
  );
}
