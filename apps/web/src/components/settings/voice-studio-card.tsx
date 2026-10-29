import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { ConnectionTestDto, SettingsDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { apiErrorMessage } from '@/lib/api-error-message';
import { docsUrl } from '@/lib/docs-url';
import { VoiceStudioStatus } from '@/components/voicestudio/VoiceStudioStatus';
import {
  VOICESTUDIO_STATUS_KEY,
  voiceStudioSourceLabel,
} from '@/components/voicestudio/voicestudio.logic';
import { ProviderKeyRow, TestResult } from './provider-keys-card';
import { isHttpUrl, SETTINGS_KEY } from './settings.logic';

/** VoiceStudio, the voice app installed separately: where Reelcraft finds it, and its API key. */
export function VoiceStudioCard({ settings }: { settings: SettingsDto }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(settings.voiceStudio.url);
  const [test, setTest] = useState<ConnectionTestDto | null>(null);
  const trimmed = url.trim();
  const valid = isHttpUrl(trimmed);
  const changed = trimmed !== settings.voiceStudio.url;
  const key = settings.keys.find((k) => k.id === 'voicestudio');

  const save = useMutation({
    mutationFn: (next: string) => api.saveVoiceStudio(next),
    onSuccess: (voiceStudio) => {
      setUrl(voiceStudio.url);
      setTest(null);
      queryClient.setQueryData<SettingsDto>(SETTINGS_KEY, (old) =>
        old ? { ...old, voiceStudio } : old,
      );
      // Another address may be another VoiceStudio, with other engines and voices.
      void queryClient.invalidateQueries({ queryKey: VOICESTUDIO_STATUS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['provider-models', 'voicestudio'] });
      void queryClient.invalidateQueries({ queryKey: ['voices', 'voicestudio'] });
    },
  });
  const check = useMutation({
    mutationFn: () => api.testVoiceStudio(trimmed),
    onSuccess: setTest,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>VoiceStudio</CardTitle>
        <CardDescription>
          Voice-over, voice cloning and transcription from VoiceStudio, a free app you install
          separately. Everything runs on your computer, with no per-request cost. Reelcraft uses the
          speech engines installed in VoiceStudio and the voices saved there.{' '}
          <a
            href={docsUrl('voice-studio')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            Guide <ExternalLink className="size-3" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <VoiceStudioStatus />

        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && changed) save.mutate(trimmed);
          }}
        >
          <Label htmlFor="voice-studio-url">VoiceStudio address</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="voice-studio-url"
              value={url}
              spellCheck={false}
              onChange={(event) => {
                setUrl(event.target.value);
                setTest(null);
              }}
              className="min-w-64 flex-1 font-mono text-xs"
            />
            <Button type="submit" disabled={!valid || !changed || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!valid || check.isPending}
              onClick={() => check.mutate()}
            >
              {check.isPending ? <Loader2 className="animate-spin" /> : null}
              Test connection
            </Button>
            {settings.voiceStudio.source === 'saved' ? (
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => save.mutate('')}
              >
                Reset
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {voiceStudioSourceLabel(settings.voiceStudio)}. VoiceStudio listens on port 3900. If
            Reelcraft runs in Docker, the computer running Docker is{' '}
            <code>host.docker.internal</code>.
          </p>
          {trimmed && !valid ? (
            <p className="text-xs text-destructive">Enter an http:// or https:// address.</p>
          ) : null}
        </form>
        {test ? <TestResult result={test} okText="Connected to VoiceStudio." /> : null}
        {save.isError ? (
          <p className="text-xs text-destructive">
            {apiErrorMessage(save.error, 'The address could not be saved.')}
          </p>
        ) : null}

        {key ? (
          <>
            <Separator />
            <ProviderKeyRow
              status={key}
              label="API key (optional)"
              linkText="About VoiceStudio keys"
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
