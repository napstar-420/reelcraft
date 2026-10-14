import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRightIcon, ExternalLink, Loader2 } from 'lucide-react';
import type { ConnectionTestDto, SettingsDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api-error-message';
import { docsUrl } from '@/lib/docs-url';
import { QwenLinkFolder } from '@/components/canvas/speech/QwenLinkFolder';
import { QwenSetupPanel } from '@/components/canvas/speech/QwenSetupPanel';
import { QWEN_MODELS_KEY, QWEN_SETUP_KEY } from '@/components/canvas/speech/qwen-setup.logic';
import { anyDownloading, formatBytes } from '@/components/canvas/speech/speech-settings.logic';
import { TestResult } from './provider-keys-card';
import { isHttpUrl, qwenTtsSourceLabel, SETTINGS_KEY } from './settings.logic';

export function QwenTtsCard({ settings }: { settings: SettingsDto }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(settings.qwenTts.url);
  const [test, setTest] = useState<ConnectionTestDto | null>(null);
  const trimmed = url.trim();
  const valid = isHttpUrl(trimmed);
  const changed = trimmed !== settings.qwenTts.url;
  // Reelcraft manages the service unless an address was saved (or set in the environment).
  const external = settings.qwenTts.source !== 'default';

  const save = useMutation({
    mutationFn: (next: string) => api.saveQwenTts(next),
    onSuccess: (qwenTts) => {
      setUrl(qwenTts.url);
      setTest(null);
      queryClient.setQueryData<SettingsDto>(SETTINGS_KEY, (old) =>
        old ? { ...old, qwenTts } : old,
      );
      // Which service is used changed, so what we know about it may differ now.
      void queryClient.invalidateQueries({ queryKey: QWEN_MODELS_KEY });
      void queryClient.invalidateQueries({ queryKey: QWEN_SETUP_KEY });
    },
  });
  const models = useQuery({
    queryKey: QWEN_MODELS_KEY,
    queryFn: () => api.listModelsForProvider('qwen-tts'),
    refetchInterval: (query) => (anyDownloading(query.state.data) ? 1000 : false),
  });
  const remove = useMutation({
    mutationFn: (modelId: string) => api.deleteLocalModel(modelId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QWEN_MODELS_KEY }),
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
          cost. Reelcraft installs and runs it when you need it, and stops it when it is idle.{' '}
          <a
            href={docsUrl('qwen-tts')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            Guide <ExternalLink className="size-3" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <QwenSetupPanel />

        {models.data && !models.data[0]?.download?.serviceDown ? (
          <div className="flex flex-col gap-2">
            <Label>Models on this computer</Label>
            {models.data.map((model) => (
              <div key={model.modelId} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm">
                  <span>{model.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {model.download?.state === 'ready'
                      ? `Downloaded · ${formatBytes(model.download.totalBytes)}`
                      : model.download?.state === 'downloading'
                        ? 'Downloading…'
                        : `Not downloaded · ${formatBytes(model.download?.totalBytes ?? 0)}`}
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
                {model.download?.state === 'not_downloaded' ||
                model.download?.state === 'failed' ? (
                  <QwenLinkFolder modelId={model.modelId} modelLabel={model.label} />
                ) : null}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Choose Qwen3-TTS in a Generate Speech stage to download a model, or point Reelcraft at
              files you already have.
            </p>
            {remove.isError ? (
              <p className="text-xs text-destructive">
                {apiErrorMessage(remove.error, 'The model could not be deleted.')}
              </p>
            ) : null}
          </div>
        ) : null}

        <Collapsible defaultOpen={external} className="flex flex-col gap-2">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="group self-start px-1">
              <ChevronRightIcon className="transition-transform group-data-[state=open]:rotate-90" />
              Use a service you run yourself
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Run the Qwen3-TTS service on your own computer or another one (see the guide), then
              save its address. Reelcraft then installs and starts nothing itself. This is also how
              Reelcraft in Docker on a Mac can use the Mac’s GPU. Reset to let Reelcraft manage it
              again.
            </p>
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
            {test ? (
              <TestResult result={test} okText="Connected to the Qwen3-TTS service." />
            ) : null}
            {save.isError ? (
              <p className="text-xs text-destructive">
                {apiErrorMessage(save.error, 'The address could not be saved.')}
              </p>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
