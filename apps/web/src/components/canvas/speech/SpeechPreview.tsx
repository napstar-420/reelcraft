import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2Icon, PlayIcon } from 'lucide-react';
import type { SpeechModelOptions } from '@reelcraft/shared';
import { api } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { InfoLabel } from '../info-label';
import { estimateSpeechCostUsd, formatUsd } from './speech-settings.logic';

const SAMPLE = 'This is how your voice-over will sound.';

/** Speaks a short line with the settings above, so you can hear a change before a run. It costs money. */
export function SpeechPreview({
  providerId,
  modelId,
  options,
  params,
}: {
  providerId: string;
  modelId: string;
  options: SpeechModelOptions;
  params: Record<string, unknown> | undefined;
}) {
  const [text, setText] = useState(SAMPLE);
  const [url, setUrl] = useState<string>();
  const audio = useRef<HTMLAudioElement>(null);
  const trimmed = text.trim();
  const estimate = estimateSpeechCostUsd(trimmed.length, options, params);

  const speak = useMutation({
    mutationFn: () =>
      api.previewSpeech(providerId, { modelId, params: params ?? {}, text: trimmed }),
    onSuccess: (sample) => {
      const bytes = Uint8Array.from(atob(sample.audioBase64), (c) => c.charCodeAt(0));
      setUrl(URL.createObjectURL(new Blob([bytes], { type: sample.mime })));
    },
  });

  // Free the previous sample's memory when a new one replaces it.
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  useEffect(() => {
    if (url) void audio.current?.play().catch(() => undefined);
  }, [url]);

  return (
    <div className="flex flex-col gap-1.5">
      <InfoLabel info="Speaks this line with the voice and settings above, so you can hear a change before running the blueprint. Each sample is a real request to the provider and is billed.">
        Hear a sample
      </InfoLabel>
      <Textarea
        rows={2}
        maxLength={300}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Sample text"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!trimmed || speak.isPending}
          onClick={() => speak.mutate()}
        >
          {speak.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
          Speak it · about {formatUsd(estimate)}
        </Button>
        {speak.isSuccess && (
          <span className="text-xs text-muted-foreground">
            Cost {formatUsd(speak.data.costUsd)}
          </span>
        )}
      </div>
      {url && <audio ref={audio} src={url} controls className="h-8 w-full" />}
      {speak.isError && (
        <p className="text-xs text-destructive">
          {apiErrorMessage(speak.error, 'The sample could not be made.')}
        </p>
      )}
    </div>
  );
}
