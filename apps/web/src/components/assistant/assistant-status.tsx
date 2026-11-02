import { useAssistantUi } from './assistant-context';

/** "Working" or "Needs you" beside the assistant's name. */
export function AssistantStatus() {
  const { assistant } = useAssistantUi();
  if (assistant.waiting)
    return (
      <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-wait-soft px-2 text-xs font-medium text-wait">
        <span className="size-1.5 rounded-full bg-current" /> Needs you
      </span>
    );
  if (assistant.running)
    return (
      <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-acc-soft px-2 text-xs font-medium text-acc">
        <span className="size-1.5 animate-pulse rounded-full bg-current" /> Working
      </span>
    );
  return null;
}
