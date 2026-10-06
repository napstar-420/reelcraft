/** The assistant's per-browser choices (provider, model, effort, auto-apply). A convenience only:
 * storage can be missing or blocked, so every access is guarded. */
export interface AssistantPrefs {
  providerId?: string;
  modelId?: string;
  effort?: string;
  autoApply?: boolean;
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
