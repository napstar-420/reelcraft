/** The assistant's per-browser choices (provider, model, effort, the open chat). A
 * convenience only: storage can be missing or blocked, so every access is guarded. */
export interface AssistantPrefs {
  providerId?: string;
  modelId?: string | undefined;
  effort?: string | undefined;
  /** The chat open in the dock, so it follows the user from page to page. `null`: a new chat. */
  sessionId?: string | null;
  /** Whether the dock is open. */
  dockOpen?: boolean;
}

const KEY = 'reelcraft.assistant';

export function loadAssistantPrefs(): AssistantPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AssistantPrefs) : {};
  } catch {
    return {};
  }
}

export function saveAssistantPrefs(patch: AssistantPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...loadAssistantPrefs(), ...patch }));
  } catch {
    // private window or blocked storage: the choice just isn't remembered
  }
}
