import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { ConnectionTestDto, SettingsDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api-error-message';
import { docsUrl } from '@/lib/docs-url';
import { anyDownloading, formatBytes } from '@/components/canvas/speech/speech-settings.logic';
import { TestResult } from './provider-keys-card';
import { isHttpUrl, qwenTtsSourceLabel, SETTINGS_KEY } from './settings.logic';

const MODELS_KEY = ['provider-models', 'qwen-tts'] as const;

export function QwenTtsCard({ settings }: { settings: SettingsDto }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(settings.qwenTts.url);
  const [test, setTest] = useState<ConnectionTestDto | null>(null);
  const trimmed = url.trim();
  const valid = isHttpUrl(trimmed);
  const changed = trimmed !== settings.qwenTts.url;

  const save = useMutation({
    mutationFn: (next: string) => api.saveQwenTts(next),
    onSuccess: (qwenTts) => {
      setUrl(qwenTts.url);
      setTest(null);
      queryClient.setQueryData<SettingsDto>(SETTINGS_KEY, (old) =>
        old ? { ...old, qwenTts } : old,
      );
      // The model and voice lists come from the service, so they may differ now.
      void queryClient.invalidateQueries({ queryKey: MODELS_KEY });
    },
  });
  const models = useQuery({
    queryKey: MODELS_KEY,
    queryFn: () => api.listModelsForProvider('qwen-tts'),
    refetchInterval: (query) => (anyDownloading(query.state.data) ? 1000 : false),
  });
  const remove = useMutation({
    mutationFn: (modelId: string) => api.deleteLocalModel(modelId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: MODELS_KEY }),
  });
  const check = useMutation({
    mutationFn: () => api.testQwenTts(trimmed),
    onSuccess: setTest,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Qwen3-TTS (local)</CardTitle>
        <CardDescription>
          Voice-over from the open Qwen3-TTS models, running on this computer with no per-request
          cost. Start the service with <code>pnpm tts</code>, then download a model when you choose
          Qwen3-TTS for a Generate Speech stage.{' '}
          <a
            href={docsUrl('qwen-tts')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            Setup guide <ExternalLink className="size-3" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && changed) save.mutate(trimmed);
          }}
        >
          <Label htmlFor="qwen-tts-url">Service address</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="qwen-tts-url"
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
            {settings.qwenTts.source === 'saved' ? (
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
            {qwenTtsSourceLabel(settings.qwenTts)}. If Reelcraft runs in Docker, the computer
            running Docker is <code>host.docker.internal</code>.
          </p>
          {trimmed && !valid ? (
            <p className="text-xs text-destructive">Enter an http:// or https:// address.</p>
          ) : null}
        </form>
        {test ? <TestResult result={test} okText="Connected to the Qwen3-TTS service." /> : null}
        {models.data && !models.data[0]?.download?.serviceDown ? (
          <div className="flex flex-col gap-2">
            <Label>Models on this computer</Label>
            {models.data.map((model) => (
              <div key={model.modelId} className="flex items-center gap-2 text-sm">
                <span>{model.label}</span>
                <span className="text-xs text-muted-foreground">
                  {model.download?.state === 'ready'
                    ? `Downloaded · ${formatBytes(model.download.totalBytes)}`
                    : model.download?.state === 'downloading'
                      ? 'Downloading…'
                      : 'Not downloaded'}
                </span>
                {model.download?.state === 'ready' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(model.modelId)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            ))}
            {remove.isError ? (
              <p className="text-xs text-destructive">
                {apiErrorMessage(remove.error, 'The model could not be deleted.')}
              </p>
            ) : null}
          </div>
        ) : null}
        {save.isError ? (
          <p className="text-xs text-destructive">
            {apiErrorMessage(save.error, 'The address could not be saved.')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
