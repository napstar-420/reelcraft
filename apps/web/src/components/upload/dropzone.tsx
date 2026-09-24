import { useEffect, useRef, useState } from 'react';
import { cn } from 'cn';
import { UploadCloud } from 'lucide-react';

export function Dropzone({
  accept,
  multiple = false,
  disabled = false,
  onFilesSelected,
  className,
}: {
  accept?: string | undefined;
  multiple?: boolean;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);

  useEffect(() => {
    return () => {
      for (const preview of previews) URL.revokeObjectURL(preview.url);
    };
  }, [previews]);

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    for (const preview of previews) URL.revokeObjectURL(preview.url);
    setPreviews(
      files
        .filter((f) => f.type.startsWith('image/'))
        .map((file) => ({ file, url: URL.createObjectURL(file) })),
    );
    onFilesSelected(files);
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-8 text-center text-muted-foreground transition-colors',
        dragging && 'border-primary bg-accent/40',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {previews.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-2 px-4">
          {previews.map((preview) => (
            <img
              key={preview.url}
              src={preview.url}
              alt={preview.file.name}
              className="h-20 w-20 rounded-lg object-cover"
            />
          ))}
        </div>
      ) : (
        <>
          <UploadCloud className="size-6" />
          <p className="text-sm">Drag and drop a file, or click to browse</p>
        </>
      )}
    </div>
  );
}
