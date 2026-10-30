import { useEffect, useRef, useState } from 'react';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AssetDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorMessage } from '@/lib/api-error-message';
import { useVoiceStudioStatus, VoiceStudioStatus } from './VoiceStudioStatus';
import { MAX_CLONE_BYTES, voiceNameFrom, voiceStudioReady } from './voicestudio.logic';

/**
 * Makes a VoiceStudio voice from a recording in the channel library. VoiceStudio keeps the voice;
 * a Generate Speech stage then picks it from the VoiceStudio voice list like any other voice.
 */
export function CloneVoiceDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const status = useVoiceStudioStatus();
  const [name, setName] = useState(() => voiceNameFrom(asset.name));
  const [transcript, setTranscript] = useState('');
  const [language, setLanguage] = useState('');
  // Whether this dialog is on screen, read by the mutation's callbacks, which still run after the
  // dialog is closed (making a voice can take minutes).
  const shown = useRef(true);
  useEffect(() => {
    shown.current = open;
    return () => {
      shown.current = false;
    };
  }, [open]);
  const mutationKey = ['voicestudio-clone', asset.id];
  // A voice still being made from this file, possibly by a dialog that was closed since.
  const making = useIsMutating({ mutationKey }) > 0;
  const clone = useMutation({
    mutationKey,
    mutationFn: () =>
      api.cloneVoiceStudioVoice({
        assetId: asset.id,
        name: name.trim(),
        ...(transcript.trim() && { transcript: transcript.trim() }),
        ...(language.trim() && { language: language.trim() }),
      }),
    onSuccess: (voice) => {
      void queryClient.invalidateQueries({ queryKey: ['voices', 'voicestudio'] });
      toast.success(
        `“${voice.name}” is saved in VoiceStudio. To use it, choose a VoiceStudio engine that can clone voices (such as OmniVoice) in a Generate Speech stage, then pick it as the voice.`,
      );
      if (shown.current) onOpenChange(false);
    },
    onError: (error) => {
      // Shown in the dialog while it is open; after it was closed, as a notice.
      if (!shown.current) toast.error(apiErrorMessage(error, 'The voice could not be made.'));
    },
  });
  const ready = voiceStudioReady(status.data);
  const tooBig = asset.file.bytes > MAX_CLONE_BYTES;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make a VoiceStudio voice</DialogTitle>
          <DialogDescription>
            VoiceStudio learns the voice in “{asset.name}” and saves it, so speech can be made in
            it. Use a clean recording of one person speaking, about 5 to 30 seconds long. Only clone
            a voice you have the right to use.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !tooBig && !making && name.trim()) clone.mutate();
          }}
        >
          {!ready ? <VoiceStudioStatus /> : null}
          {making ? (
            <p className="text-sm text-muted-foreground">
              VoiceStudio is making a voice from this file. You can close this window: Reelcraft
              tells you when it is done.
            </p>
          ) : null}
          {tooBig ? (
            <p className="text-sm text-destructive">
              This file is too large to clone from (over {MAX_CLONE_BYTES / 1_000_000} MB). Upload a
              short recording instead: 5 to 30 seconds of one person speaking is enough.
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="clone-name">Voice name</Label>
            <Input
              id="clone-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="clone-transcript">What the recording says (optional)</Label>
            <Textarea
              id="clone-transcript"
              rows={3}
              maxLength={2000}
              placeholder="Leave empty and VoiceStudio transcribes it."
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="clone-language">Language (optional)</Label>
            <Input
              id="clone-language"
              className="w-40"
              maxLength={20}
              placeholder="e.g. en"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            />
          </div>
          {clone.isError ? (
            <p className="text-sm text-destructive">
              {apiErrorMessage(clone.error, 'The voice could not be made.')}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || tooBig || !name.trim() || making}>
              {making ? <Loader2 className="animate-spin" /> : null}
              {making ? 'Making the voice…' : 'Make voice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
