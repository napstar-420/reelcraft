import { useCallback, useState } from 'react';
import { ApiError } from '@/api/client';
import { sha256Hex } from '@/lib/sha256';

export type UploadStatus = 'idle' | 'hashing' | 'uploading' | 'confirming' | 'done' | 'error';

function putWithProgress(url: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Upload failed: network error'));
    xhr.send(file);
  });
}

export function useUpload<TConfirmResult>(opts: {
  requestUpload: (ext: string) => Promise<{ blobId: string; objectKey: string; uploadUrl: string }>;
  confirm: (args: { blobId: string; objectKey: string; sha256: string }) => Promise<TConfirmResult>;
}) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setProgress(0);
    setStatus('idle');
    setError(null);
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setProgress(0);
      try {
        const ext = file.name.includes('.') ? file.name.split('.').pop()! : '';
        setStatus('hashing');
        const sha256 = await sha256Hex(file);
        const { blobId, objectKey, uploadUrl } = await opts.requestUpload(ext);
        setStatus('uploading');
        await putWithProgress(uploadUrl, file, setProgress);
        setStatus('confirming');
        const result = await opts.confirm({ blobId, objectKey, sha256 });
        setStatus('done');
        return result;
      } catch (err) {
        setStatus('error');
        setError(err instanceof ApiError ? err.message : (err as Error).message);
        throw err;
      }
    },
    [opts],
  );

  return { upload, progress, status, error, reset };
}
