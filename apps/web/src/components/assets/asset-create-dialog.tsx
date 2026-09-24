import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssetKind } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Dropzone } from '@/components/upload/dropzone';
import { useUpload } from '@/components/upload/use-upload';

const ASSET_KINDS: { value: AssetKind; label: string; accept: string }[] = [
  { value: 'media.image', label: 'Image', accept: 'image/*' },
  { value: 'media.video', label: 'Video', accept: 'video/*' },
  { value: 'media.audio', label: 'Audio', accept: 'audio/*' },
  { value: 'font', label: 'Font', accept: '.ttf,.otf,.woff,.woff2' },
  { value: 'lut', label: 'LUT', accept: '.cube' },
];

export function AssetCreateDialog({
  channelId,
  open,
  onOpenChange,
}: {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AssetKind>('media.image');
  const [tags, setTags] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const { upload, progress, status, error, reset } = useUpload({
    requestUpload: (ext) => api.requestAssetUpload(channelId, ext),
    confirm: (args) =>
      api.createAsset(channelId, {
        name,
        kind,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        ...args,
      }),
  });

  const pending = status === 'hashing' || status === 'uploading' || status === 'confirming';
  const accept = ASSET_KINDS.find((k) => k.value === kind)?.accept;

  function close() {
    setName('');
    setKind('media.image');
    setTags('');
    setFile(null);
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New asset</DialogTitle>
          <DialogDescription>Upload reusable media for this channel.</DialogDescription>
        </DialogHeader>
        <form
          id="asset-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || !file) return;
            await upload(file);
            void queryClient.invalidateQueries({ queryKey: ['assets', channelId] });
            close();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-name">Name</Label>
            <Input
              id="asset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Asset name"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as AssetKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSET_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-tags">Tags</Label>
            <Input
              id="asset-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. intro, brand"
            />
            <p className="text-xs text-muted-foreground">Separate multiple tags with commas.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>File</Label>
            <Dropzone accept={accept} onFilesSelected={(files) => setFile(files[0] ?? null)} />
          </div>
          {status === 'uploading' && <Progress value={progress} />}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button type="submit" form="asset-form" disabled={pending || !file || !name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
