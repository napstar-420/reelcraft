import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { AssistantAttachmentDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { sha256Hex } from '@/lib/sha256';
import { putWithProgress } from '@/components/upload/use-upload';
import {
  HASH_LIMIT,
  MAX_FILES,
  extensionOf,
  fileKind,
  refusal,
  type AttachmentKind,
} from './attachments.logic';

export interface PendingAttachment {
  key: string;
  name: string;
  kind: AttachmentKind;
  /** A local preview for pictures, until the upload is confirmed. */
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'error';
  progress: number;
  error: string | null;
  attachment: AssistantAttachmentDto | null;
}

let counter = 0;

/** The files waiting in the composer: each uploads as soon as it's added. */
export function useChatAttachments() {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // free local previews when the composer goes away
  useEffect(
    () => () => {
      for (const item of itemsRef.current)
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    },
    [],
  );

  const patch = (key: string, change: Partial<PendingAttachment>) =>
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const upload = useCallback(async (key: string, file: File) => {
    try {
      const sha256 = file.size <= HASH_LIMIT ? await sha256Hex(file) : undefined;
      const target = await api.requestAssistantAttachmentUpload(extensionOf(file.name));
      await putWithProgress(target.uploadUrl, file, (progress) => patch(key, { progress }));
      const attachment = await api.createAssistantAttachment({
        blobId: target.blobId,
        objectKey: target.objectKey,
        ...(sha256 ? { sha256 } : {}),
        name: file.name.slice(0, 200),
      });
      patch(key, { status: 'ready', progress: 100, attachment });
    } catch (error) {
      patch(key, { status: 'error', error: apiErrorMessage(error, 'Upload failed') });
    }
  }, []);

  const add = useCallback(
    (files: File[]) => {
      const room = MAX_FILES - itemsRef.current.length;
      if (files.length > room) {
        toast.error(`A message can carry ${MAX_FILES} files.`);
      }
      const accepted: Array<{ item: PendingAttachment; file: File }> = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        const problem = refusal(file);
        if (problem) {
          toast.error(problem);
          continue;
        }
        const kind = fileKind(file);
        accepted.push({
          file,
          item: {
            key: `att-${(counter += 1)}`,
            name: file.name,
            kind,
            previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
            status: 'uploading',
            progress: 0,
            error: null,
            attachment: null,
          },
        });
      }
      if (accepted.length === 0) return;
      setItems((list) => [...list, ...accepted.map((a) => a.item)]);
      for (const { item, file } of accepted) void upload(item.key, file);
    },
    [upload],
  );

  const remove = useCallback((key: string) => {
    const item = itemsRef.current.find((i) => i.key === key);
    if (!item) return;
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setItems((list) => list.filter((i) => i.key !== key));
    // an uploaded file nobody sends is deleted now (the server would sweep it after a day)
    if (item.attachment) void api.deleteAssistantAttachment(item.attachment.id).catch(() => {});
  }, []);

  /** After the message is sent: forget the files without deleting them (the chat has them now). */
  const clear = useCallback(() => {
    for (const item of itemsRef.current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setItems([]);
  }, []);

  return {
    items,
    add,
    remove,
    clear,
    uploading: items.some((i) => i.status === 'uploading'),
    readyIds: items.filter((i) => i.status === 'ready').map((i) => i.attachment!.id),
    failed: items.some((i) => i.status === 'error'),
  };
}

export type ChatAttachments = ReturnType<typeof useChatAttachments>;
