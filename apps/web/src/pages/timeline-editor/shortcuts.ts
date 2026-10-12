/** What a key press does in the editor. */
export type ShortcutAction =
  | 'play_pause'
  | 'frame_back'
  | 'frame_forward'
  | 'second_back'
  | 'second_forward'
  | 'to_start'
  | 'to_end'
  | 'split'
  | 'delete'
  | 'ripple_delete'
  | 'undo'
  | 'redo'
  | 'zoom_in'
  | 'zoom_out'
  | 'zoom_fit'
  | 'deselect'
  | 'nudge_back'
  | 'nudge_forward';

export type KeyInfo = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** The shortcuts, in the order the help lists them. */
export const SHORTCUT_HELP: Array<{ keys: string; label: string }> = [
  { keys: 'Space', label: 'Play or pause' },
  { keys: '← →', label: 'Step one frame' },
  { keys: '⇧ ← →', label: 'Jump one second' },
  { keys: 'Home / End', label: 'Go to the start or end' },
  { keys: 'S', label: 'Split at the playhead' },
  { keys: 'Delete', label: 'Delete the selection' },
  { keys: '⇧ Delete', label: 'Delete and close the gap' },
  { keys: '[ ]', label: 'Nudge the selection by 0.1 s' },
  { keys: '⌘ Z / ⇧ ⌘ Z', label: 'Undo / redo' },
  { keys: '+ −', label: 'Zoom the timeline' },
  { keys: '0', label: 'Fit the timeline to the window' },
  { keys: 'Esc', label: 'Clear the selection' },
];

/** Maps a key press to an editor action, or undefined when it isn't one. Meta (⌘) and Ctrl both
 * count as the command key, so the shortcuts work on every platform. */
export function shortcutFor(event: KeyInfo): ShortcutAction | undefined {
  const command = event.metaKey || event.ctrlKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (command) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    return undefined;
  }
  if (event.altKey) return undefined;
  switch (key) {
    case ' ':
      return 'play_pause';
    case 'ArrowLeft':
      return event.shiftKey ? 'second_back' : 'frame_back';
    case 'ArrowRight':
      return event.shiftKey ? 'second_forward' : 'frame_forward';
    case 'Home':
      return 'to_start';
    case 'End':
      return 'to_end';
    case 's':
      return 'split';
    case 'Delete':
    case 'Backspace':
      return event.shiftKey ? 'ripple_delete' : 'delete';
    case '[':
      return 'nudge_back';
    case ']':
      return 'nudge_forward';
    case '+':
    case '=':
      return 'zoom_in';
    case '-':
    case '_':
      return 'zoom_out';
    case '0':
      return 'zoom_fit';
    case 'Escape':
      return 'deselect';
    default:
      return undefined;
  }
}

/** True when the key press is going into a text field, so shortcuts must stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
