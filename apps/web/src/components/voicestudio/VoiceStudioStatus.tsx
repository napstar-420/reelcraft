import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, RefreshCwIcon } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  describeVoiceStudio,
  type StatusTone,
  VOICESTUDIO_STATUS_KEY,
  voiceStudioBrowserUrl,
  voiceStudioReady,
} from './voicestudio.logic';

const DOT: Record<StatusTone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-destructive',
  muted: 'bg-muted-foreground/50',
};

/** VoiceStudio's state now, kept fresh while it is starting or closed. */
export function useVoiceStudioStatus() {
  return useQuery({
    queryKey: VOICESTUDIO_STATUS_KEY,
    queryFn: api.voiceStudioStatus,
    refetchInterval: (query) => (voiceStudioReady(query.state.data) ? 30_000 : 5_000),
  });
}

/** Where VoiceStudio stands, with Check again and a link to open VoiceStudio itself. */
export function VoiceStudioStatus() {
  const queryClient = useQueryClient();
  const status = useVoiceStudioStatus();
  const { text, tone } = describeVoiceStudio(status.data);
  const recheck = () => {
    void queryClient.invalidateQueries({ queryKey: VOICESTUDIO_STATUS_KEY });
    // The engines and voices it offers may have changed too.
    void queryClient.invalidateQueries({ queryKey: ['provider-models', 'voicestudio'] });
    void queryClient.invalidateQueries({ queryKey: ['voices', 'voicestudio'] });
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-start gap-2 text-sm">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden />
        <span className="flex-1">{text}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={status.isFetching}
          onClick={recheck}
        >
          {status.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCwIcon />}
          Check again
        </Button>
        {status.data ? (
          <Button type="button" variant="ghost" size="sm" asChild>
            <a href={voiceStudioBrowserUrl(status.data.url)} target="_blank" rel="noreferrer">
              Open VoiceStudio <ExternalLink />
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
