import type { ArtifactViewDto } from '@reelcraft/shared';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { mediaFacts } from './media-view.logic';

/** A `media.image_list` artifact: every image in order, each openable on its own. */
export function ImageListView({ images }: { images: NonNullable<ArtifactViewDto['images']> }) {
  if (images.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No images are available.</p>;
  }
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
      {images.map((image, position) => (
        <div
          key={image.url}
          className="flex flex-col overflow-hidden rounded-md border bg-background"
        >
          <a href={image.url} target="_blank" rel="noreferrer">
            <img
              src={image.url}
              alt={image.label || `Image ${position + 1}`}
              loading="lazy"
              className="aspect-square w-full bg-muted/30 object-contain"
            />
          </a>
          <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {image.label || `Image ${position + 1}`}
            </span>
            {mediaFacts('media.image', image.probe)
              .slice(0, 2)
              .map((fact) => (
                <Badge key={fact} variant="outline" className="font-normal">
                  {fact}
                </Badge>
              ))}
            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              aria-label={`Download image ${position + 1}`}
            >
              <a href={image.url} target="_blank" rel="noreferrer" download>
                <Download />
              </a>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
