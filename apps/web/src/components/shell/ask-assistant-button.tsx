import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Floating entry to the assistant on pages where it is not already on screen. */
export function AskAssistantButton() {
  return (
    <Link
      to="/?focus=assistant"
      className="fixed right-6 bottom-6 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-acc px-[18px] text-sm font-medium text-acc-foreground shadow-[0_12px_30px_-10px_rgba(0,0,0,0.6)] transition-transform hover:scale-[1.03]"
    >
      <Sparkles className="size-[15px]" />
      Ask the assistant
      <span className="font-mono text-[11px] opacity-70">Cmd J</span>
    </Link>
  );
}
