import Markdown, { type Components } from 'react-markdown';
import { AlertCircle, Wrench } from 'lucide-react';
import type { AssistantItemDto, ToolCallPayload, TurnStatusPayload } from '@reelcraft/shared';
import type { AssistantController } from '@/hooks/useAssistant';
import { ProposalCard } from './proposal-card';
import { QuestionCard } from './question-card';
import { describeToolCall, payloadOf, toRows, type ChatRow } from './assistant.logic';

const MARKDOWN: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer" className="underline underline-offset-2" />
  ),
  p: ({ node: _node, ...props }) => <p {...props} className="my-1.5 first:mt-0 last:mb-0" />,
  pre: ({ node: _node, ...props }) => (
    <pre {...props} className="my-1.5 overflow-x-auto rounded bg-muted p-2 font-mono text-xs" />
  ),
  code: ({ node: _node, ...props }) => <code {...props} className="font-mono text-[0.85em]" />,
  ul: ({ node: _node, ...props }) => (
    <ul {...props} className="my-1.5 list-disc space-y-0.5 pl-5" />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol {...props} className="my-1.5 list-decimal space-y-0.5 pl-5" />
  ),
  h1: ({ node: _node, ...props }) => <p {...props} className="my-1.5 font-semibold" />,
  h2: ({ node: _node, ...props }) => <p {...props} className="my-1.5 font-semibold" />,
  h3: ({ node: _node, ...props }) => <p {...props} className="my-1.5 font-semibold" />,
};

function ToolsRow({ items }: { items: AssistantItemDto[] }) {
  const lines = items.map((i) => describeToolCall(payloadOf<ToolCallPayload>(i), i.state));
  const last = lines.at(-1) ?? '';
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 hover:text-foreground">
        <Wrench className="size-3 shrink-0" />
        <span className="truncate">
          {lines.length > 1 ? `${lines.length} steps · ${last}` : last}
        </span>
      </summary>
      <ul className="mt-1 space-y-0.5 border-l pl-3">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

function Row({
  row,
  items,
  assistant,
}: {
  row: ChatRow;
  items: AssistantItemDto[];
  assistant: AssistantController;
}) {
  switch (row.kind) {
    case 'user':
      return (
        <div className="ml-8 self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
          {payloadOf<{ text: string }>(row.item).text}
        </div>
      );
    case 'agent':
      return (
        <div className="mr-4 text-sm">
          <Markdown components={MARKDOWN}>{payloadOf<{ text: string }>(row.item).text}</Markdown>
        </div>
      );
    case 'tools':
      return <ToolsRow items={row.items} />;
    case 'proposal':
      return <ProposalCard item={row.item} items={items} assistant={assistant} />;
    case 'question':
      return <QuestionCard item={row.item} assistant={assistant} />;
    case 'problem': {
      const status = payloadOf<TurnStatusPayload>(row.item);
      return (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {row.item.state === 'interrupted'
            ? (status.error ?? 'Stopped.')
            : (status.error ?? 'The assistant failed.')}
        </p>
      );
    }
  }
}

export function AssistantMessages({
  items,
  assistant,
}: {
  items: AssistantItemDto[];
  assistant: AssistantController;
}) {
  const rows = toRows(items);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <Row
          key={row.kind === 'tools' ? row.id : row.item.id}
          row={row}
          items={items}
          assistant={assistant}
        />
      ))}
    </div>
  );
}
