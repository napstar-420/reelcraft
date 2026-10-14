import type { QwenTtsSetupDto } from '@reelcraft/shared';
import { formatBytes } from './speech-settings.logic';

/** Query keys for the setup status and the model list, shared by the panel and the cards. */
export const QWEN_SETUP_KEY = ['qwen-tts-setup'] as const;
export const QWEN_MODELS_KEY = ['provider-models', 'qwen-tts'] as const;

/** The voice models, downloaded separately from the software and only when one is chosen. */
export const MODEL_SIZES_TEXT = '2.5 GB or 4.5 GB';
/** Room to leave on the disk after installing (the API checks the same). */
const DISK_MARGIN_BYTES = 1e9;

export type BrowserOs = 'mac' | 'windows' | 'linux' | 'other';

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/**
 * The OS of the computer the browser runs on. The API can't say: in Docker it always reports Linux,
 * and the browser is on the user's own computer.
 */
export function browserOs(
  nav: NavigatorLike = typeof navigator === 'undefined' ? {} : (navigator as NavigatorLike),
): BrowserOs {
  const text = (nav.userAgentData?.platform || nav.platform || nav.userAgent || '').toLowerCase();
  if (text.includes('mac')) return 'mac';
  if (text.includes('win')) return 'windows';
  if (text.includes('linux') || text.includes('x11')) return 'linux';
  return 'other';
}

/** The documented way to install uv on each OS. */
export function uvInstallCommand(os: BrowserOs): string {
  return os === 'windows'
    ? 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
    : 'curl -LsSf https://astral.sh/uv/install.sh | sh';
}

/** The documented `docker run` for Reelcraft, with the NVIDIA GPU passed in. One line, so it pastes anywhere. */
export const DOCKER_GPU_COMMAND =
  'docker run -d --name reelcraft --restart unless-stopped --gpus all -p 8080:8080 -v reelcraft-data:/data zohaibkhan97/reelcraft';

export type SetupActionId =
  'install' | 'install-cpu' | 'cancel' | 'start' | 'stop' | 'reinstall' | 'check';

export interface SetupView {
  headline: string;
  detail: string | null;
  tone: 'ok' | 'muted' | 'warn' | 'error';
  /** Something is under way: show that it is working. */
  busy: boolean;
  actions: SetupActionId[];
  showLog: boolean;
  /** The command that installs uv, when it is missing. */
  uvCommand: string | null;
  /** Guidance about GPUs under Docker. */
  hints: string[];
}

/** "about 1.2 GB", or "about 5 GB (an estimate)" where it was not measured. */
export function packageSizeText(dto: QwenTtsSetupDto): string {
  const { packagesBytes, packagesEstimated } = dto.sizes;
  return `about ${formatBytes(packagesBytes)}${packagesEstimated ? ' (an estimate)' : ''}`;
}

/** There is room for the software, with some to spare. Unknown space counts as enough. */
export function hasRoomForInstall(dto: QwenTtsSetupDto): boolean {
  const { freeBytes, packagesBytes } = dto.sizes;
  return freeBytes === null || freeBytes >= packagesBytes + DISK_MARGIN_BYTES;
}

/** "Running on: Apple GPU (MPS)", or why it is the CPU. */
export function deviceLine(dto: QwenTtsSetupDto): string {
  if (!dto.deviceLabel) return 'Checking which GPU it can use…';
  const reason = dto.deviceReason && dto.device === 'cpu' ? ` (${dto.deviceReason})` : '';
  return `Running on: ${dto.deviceLabel}${reason}`;
}

/** What to tell people about GPUs when Reelcraft runs inside Docker. */
export function gpuHints(dto: QwenTtsSetupDto, os: BrowserOs): string[] {
  if (!dto.inContainer) return [];
  if (os === 'mac') {
    return [
      "Docker on a Mac can't use your Mac's GPU, so Qwen3-TTS runs on the CPU here. For faster speech, run the service on your Mac itself (see the guide) and enter its address under “Use a service you run yourself”.",
    ];
  }
  if (!dto.nvidiaGpu) {
    return [
      'No GPU is visible inside Docker. If you have an NVIDIA GPU, start Reelcraft with --gpus all to use it (on Linux this also needs the NVIDIA Container Toolkit). See the guide.',
    ];
  }
  return [];
}

/** What the setup panel shows and offers for this status. */
export function describeSetup(dto: QwenTtsSetupDto, os: BrowserOs): SetupView {
  const view = (v: Partial<SetupView> & Pick<SetupView, 'headline'>): SetupView => ({
    detail: null,
    tone: 'muted',
    busy: false,
    actions: [],
    showLog: false,
    uvCommand: null,
    hints: [],
    ...v,
  });

  if (dto.mode === 'external') {
    return dto.phase === 'running'
      ? view({
          headline: 'Using the service you run yourself',
          detail: dto.deviceLabel ? deviceLine(dto) : null,
          tone: 'ok',
        })
      : view({
          headline: "Can't reach the service you run yourself",
          detail: dto.error,
          tone: 'warn',
        });
  }

  const hints = gpuHints(dto, os);
  switch (dto.phase) {
    case 'unavailable':
      return view({ headline: "Set up isn't available here", detail: dto.error, tone: 'warn' });
    case 'needs-uv':
      return view({
        headline: 'Install uv first',
        detail:
          'Reelcraft uses uv to install Qwen3-TTS. Run this in a terminal, then select Check again.',
        tone: 'warn',
        actions: ['check'],
        uvCommand: uvInstallCommand(os),
      });
    case 'not-installed':
      return view({
        headline: 'Qwen3-TTS needs a one-time setup',
        detail: `This installs the software it runs on (${packageSizeText(dto)}). The voice models (${MODEL_SIZES_TEXT}) are downloaded separately, only when you choose one.`,
        actions: ['install'],
        hints,
      });
    case 'outdated':
      return view({
        headline: 'The installed software is out of date',
        detail: 'Reinstall it to match this version of Reelcraft.',
        tone: 'warn',
        actions: ['reinstall'],
        hints,
      });
    case 'installing':
      return view({
        headline: 'Installing…',
        detail: 'This can take a few minutes. You can leave this page open or come back.',
        busy: true,
        actions: ['cancel'],
        showLog: true,
      });
    case 'install-failed':
      return view({
        headline: 'The install failed',
        detail: dto.error,
        tone: 'error',
        actions: ['install', 'install-cpu'],
        showLog: true,
        hints,
      });
    case 'stopped':
      return view({
        headline: 'Ready',
        detail: 'It starts when you use it and stops when it has been idle for a while.',
        tone: 'ok',
        actions: ['start', 'reinstall'],
        hints,
      });
    case 'starting':
      return view({ headline: 'Starting…', busy: true, showLog: true });
    case 'running':
      return dto.owned
        ? view({
            headline: deviceLine(dto),
            detail: 'It stops by itself when it has been idle for a while.',
            tone: 'ok',
            actions: ['stop', 'reinstall'],
            hints,
          })
        : view({
            headline: deviceLine(dto),
            detail: 'Started outside Reelcraft: stop it where you started it.',
            tone: 'ok',
          });
    case 'stopping':
      return view({ headline: 'Stopping…', busy: true });
    case 'failed':
      return view({
        headline: 'The service stopped unexpectedly',
        detail: dto.error,
        tone: 'error',
        actions: ['start', 'reinstall'],
        showLog: true,
        hints,
      });
  }
}

/** How often to ask for the status: fast while something is changing, slowly otherwise. */
export function setupPollMs(dto: QwenTtsSetupDto | undefined): number {
  if (!dto) return 3000;
  if (['installing', 'starting', 'stopping'].includes(dto.phase)) return 1000;
  if (dto.phase === 'running' && !dto.deviceLabel) return 2000; // the device is still being worked out
  return 15000;
}
