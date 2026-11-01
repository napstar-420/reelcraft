import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
} from 'lucide-react';
import type { QwenTtsSetupDto } from '@reelcraft/shared';
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
import { apiErrorMessage } from '@/lib/api-error-message';
import { docsUrl } from '@/lib/docs-url';
import {
  browserOs,
  DOCKER_GPU_COMMAND,
  describeSetup,
  hasRoomForInstall,
  MODEL_SIZES_TEXT,
  packageSizeText,
  QWEN_MODELS_KEY,
  QWEN_SETUP_KEY,
  setupPollMs,
  type SetupActionId,
  type SetupView,
} from './qwen-setup.logic';
import { formatBytes } from './speech-settings.logic';

const DOT: Record<SetupView['tone'], string> = {
  ok: 'bg-ok',
  muted: 'bg-muted-foreground/50',
  warn: 'bg-wait',
  error: 'bg-destructive',
};

function label(id: SetupActionId, dto: QwenTtsSetupDto): string {
  switch (id) {
    case 'install':
      return dto.phase === 'install-failed' ? 'Try again' : 'Set up Qwen3-TTS';
    case 'install-cpu':
      return 'Install for CPU instead';
    case 'reinstall':
      return 'Reinstall for this hardware';
    case 'cancel':
      return 'Cancel';
    case 'start':
      return 'Start now';
    case 'stop':
      return 'Stop';
    case 'check':
      return 'Check again';
  }
}

const ICON: Partial<Record<SetupActionId, typeof PlayIcon>> = {
  install: DownloadIcon,
  'install-cpu': DownloadIcon,
  reinstall: RefreshCwIcon,
  start: PlayIcon,
  stop: SquareIcon,
  check: RefreshCwIcon,
};

/** A command to paste in a terminal, with a copy button. */
function CommandBox({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted p-2">
      <code className="flex-1 font-mono text-xs break-all">{command}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Copy the command"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(command)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

/**
 * Sets up the local Qwen3-TTS service from the app: installs it, starts it, stops it, and says which
 * device it uses. Shown where a model needs it (the speech editor) and in Settings.
 */
export function QwenSetupPanel() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<SetupActionId | null>(null);
  const setup = useQuery({
    queryKey: QWEN_SETUP_KEY,
    queryFn: () => api.qwenSetup(),
    refetchInterval: (query) => setupPollMs(query.state.data),
  });
  const act = useMutation({
    mutationFn: (id: SetupActionId) => {
      switch (id) {
        case 'install':
        case 'reinstall':
          return api.installQwen('auto');
        case 'install-cpu':
          return api.installQwen('cpu');
        case 'cancel':
          return api.cancelQwenInstall();
        case 'start':
          return api.startQwen();
        case 'stop':
          return api.stopQwen();
        case 'check':
          return api.checkQwenAgain();
      }
    },
    onSuccess: (dto) => {
      queryClient.setQueryData(QWEN_SETUP_KEY, dto);
      void queryClient.invalidateQueries({ queryKey: QWEN_MODELS_KEY });
      setConfirming(null);
    },
  });

  if (setup.isPending) return <p className="text-xs text-muted-foreground">Checking…</p>;
  if (setup.isError) {
    return (
      <p className="text-xs text-destructive">
        {apiErrorMessage(setup.error, 'Could not check the Qwen3-TTS setup.')}
      </p>
    );
  }

  const dto = setup.data;
  const view = describeSetup(dto, browserOs());
  const needsConfirm = (id: SetupActionId) =>
    id === 'install' || id === 'install-cpu' || id === 'reinstall';
  const roomy = hasRoomForInstall(dto);

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        {view.busy ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <span className={`size-2 shrink-0 rounded-full ${DOT[view.tone]}`} />
        )}
        {view.headline}
      </div>
      {view.detail && (
        <p
          className={`text-xs ${view.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {view.detail}
        </p>
      )}
      {view.uvCommand && <CommandBox command={view.uvCommand} />}
      {view.hints.map((hint) => (
        <p key={hint} className="text-xs text-wait">
          {hint}{' '}
          <a
            href={docsUrl('qwen-tts')}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Guide
          </a>
        </p>
      ))}
      {dto.inContainer && !dto.nvidiaGpu && dto.mode === 'managed' && !view.busy && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Command to start Reelcraft with an NVIDIA GPU
          </summary>
          <div className="mt-1.5">
            <CommandBox command={DOCKER_GPU_COMMAND} />
          </div>
        </details>
      )}
      {view.showLog && dto.log && (
        <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
          {dto.log}
        </pre>
      )}
      {view.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {view.actions.map((id) => {
            const Icon = ICON[id];
            return (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={id === 'install' || id === 'start' ? 'default' : 'outline'}
                disabled={act.isPending}
                onClick={() => (needsConfirm(id) ? setConfirming(id) : act.mutate(id))}
              >
                {act.isPending && act.variables === id ? (
                  <Loader2Icon className="animate-spin" />
                ) : Icon ? (
                  <Icon />
                ) : null}
                {label(id, dto)}
              </Button>
            );
          })}
        </div>
      )}
      {act.isError && !confirming && (
        <p className="text-xs text-destructive">
          {apiErrorMessage(act.error, 'That did not work.')}
        </p>
      )}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === 'reinstall' ? 'Reinstall' : 'Set up'} Qwen3-TTS?
            </DialogTitle>
            <DialogDescription>
              This installs the software Qwen3-TTS runs on, {packageSizeText(dto)}, into{' '}
              <code>{dto.homeDir}</code>.{' '}
              {confirming === 'install-cpu'
                ? 'It uses the CPU version.'
                : dto.nvidiaGpu
                  ? `An NVIDIA GPU was found (${dto.nvidiaGpu}), so the GPU version is installed, which is larger.`
                  : 'It uses your GPU if it has a supported one, and the CPU otherwise.'}{' '}
              The voice models ({MODEL_SIZES_TEXT}) are downloaded separately, only when you choose
              one.
            </DialogDescription>
          </DialogHeader>
          {dto.sizes.freeBytes !== null && (
            <p className={`text-sm ${roomy ? 'text-muted-foreground' : 'text-destructive'}`}>
              {roomy
                ? `${formatBytes(dto.sizes.freeBytes)} free on that disk.`
                : `Only ${formatBytes(dto.sizes.freeBytes)} is free on that disk. Free up some space first.`}
            </p>
          )}
          {act.isError && (
            <p className="text-sm text-destructive">
              {apiErrorMessage(act.error, 'The install could not be started.')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>
              Not now
            </Button>
            <Button
              type="button"
              disabled={!roomy || act.isPending || confirming === null}
              onClick={() => confirming && act.mutate(confirming)}
            >
              {act.isPending ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
              Install
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
