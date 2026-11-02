import { AlertCircle, FileText, Film, Loader2, Music, X } from 'lucide-react';
import { cn } from 'cn';
import type { AssistantAttachmentRef } from '@reelcraft/shared';
import { formatDuration, type AttachmentKind } from './attachments.logic';
import type { PendingAttachment } from './use-chat-attachments';

function KindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  if (kind === 'video') return <Film className={className} />;
  if (kind === 'audio') return <Music className={className} />;
  return <FileText className={className} />;
}

/** The files waiting in the composer, each with its upload state. */
export function PendingAttachmentChips({
  items,
  onRemove,
}: {
  items: PendingAttachment[];
  onRemove: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mb-1.5 flex flex-wrap gap-1.5" aria-label="Attached files">
      {items.map((item) => {
        const src =
          item.kind === 'image'
            ? (item.previewUrl ?? (item.attachment ? `/api/blobs/${item.attachment.blobId}` : null))
            : null;
        return (
          <li
            key={item.key}
            title={item.error ?? item.name}
            className={cn(
              'relative flex h-10 max-w-[13rem] items-center gap-2 rounded-lg border bg-surface-2 pr-6 pl-1 text-xs',
              item.status === 'error' && 'border-destructive/50 text-destructive',
            )}
          >
            <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-3">
              {src ? (
                <img src={src} alt="" className="size-full object-cover" />
              ) : (
                <KindIcon kind={item.kind} className="size-4 text-muted-foreground" />
              )}
              {item.status === 'uploading' && (
                <span className="absolute inset-0 grid place-items-center bg-background/60">
                  <Loader2 className="size-3.5 animate-spin" />
                </span>
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate">{item.name}</span>
              <span className="block text-[11px] text-muted-foreground">
                {item.status === 'uploading' ? (
                  `Uploading ${item.progress}%`
                ) : item.status === 'error' ? (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <AlertCircle className="size-3" /> Not attached
                  </span>
                ) : (
                  (formatDuration(item.attachment?.durationSec ?? null) ?? 'Ready')
                )}
              </span>
            </span>
            <button
              type="button"
              aria-label={`Remove ${item.name}`}
              className="absolute top-1 right-1 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => onRemove(item.key)}
            >
              <X className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The files a sent message carried: pictures as thumbnails, other files as chips. */
export function MessageAttachments({ attachments }: { attachments: AssistantAttachmentRef[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {attachments.map((a) => (
        <li key={a.id}>
          <a
            href={`/api/blobs/${a.blobId}`}
            target="_blank"
            rel="noreferrer"
            title={a.sourceUrl ? `${a.name} (from ${a.sourceUrl})` : a.name}
            className="block overflow-hidden rounded-lg border bg-surface-2 hover:border-faint"
          >
            {a.kind === 'image' ? (
              <img
                src={`/api/blobs/${a.blobId}`}
                alt={a.name}
                className="h-20 max-w-[9rem] object-cover"
              />
            ) : (
              <span className="flex h-10 max-w-[13rem] items-center gap-2 px-2 text-xs">
                <KindIcon kind={a.kind} className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate">{a.name}</span>
                  {a.durationSec !== null && (
                    <span className="block text-[11px] text-muted-foreground">
                      {formatDuration(a.durationSec)}
                      {a.width && a.height ? ` · ${a.width}×${a.height}` : ''}
                    </span>
                  )}
                </span>
              </span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
