import { useState } from 'react';
import { Check } from 'lucide-react';
import type { AssistantItemDto } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AssistantController } from '@/hooks/useAssistant';
import { OTHER, buildAnswers, questionOf, type QuestionSelection } from './assistant.logic';

/** Questions from the assistant: each one's options plus a last "Other…" with a text box. */
export function QuestionCard({
  item,
  assistant,
}: {
  item: AssistantItemDto;
  assistant: AssistantController;
}) {
  const { questions, answers } = questionOf(item);
  const [selection, setSelection] = useState<Record<string, QuestionSelection | undefined>>({});
  const pending = item.state === 'pending';

  if (!pending) {
    return (
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        {item.state === 'dismissed' ? (
          <p>Skipped: you sent another message instead.</p>
        ) : (
          <ul className="space-y-0.5">
            {questions.map((q) => {
              const answer = answers?.[q.id];
              return (
                <li key={q.id} className="flex gap-1">
                  <Check className="mt-0.5 size-3 shrink-0" />
                  <span>
                    <span className="font-medium text-foreground">{q.header}:</span>{' '}
                    {Array.isArray(answer) ? answer.join(', ') : answer}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  const { complete, answers: built } = buildAnswers(questions, selection);
  const pick = (id: string, choice: string, multi: boolean) =>
    setSelection((prev) => {
      const current = prev[id] ?? { choices: [], other: '' };
      const has = current.choices.includes(choice);
      const choices = multi
        ? has
          ? current.choices.filter((c) => c !== choice)
          : [...current.choices, choice]
        : [choice];
      return { ...prev, [id]: { ...current, choices } };
    });

  return (
    <form
      className="space-y-3 rounded-lg border border-primary/40 bg-card p-3 shadow-xs"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete) assistant.answer(item.id, built);
      }}
    >
      {questions.map((q) => {
        const current = selection[q.id] ?? { choices: [], other: '' };
        const options = [
          ...q.options.map((o) => ({ label: o.label, description: o.description })),
          { label: OTHER, description: undefined },
        ];
        return (
          <fieldset key={q.id} className="space-y-1.5">
            <legend className="text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
              {q.header}
            </legend>
            <p className="text-sm">{q.question}</p>
            <div className="space-y-1">
              {options.map((option) => {
                const checked = current.choices.includes(option.label);
                const isOther = option.label === OTHER;
                return (
                  <div key={option.label}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60">
                      <input
                        type={q.multiSelect ? 'checkbox' : 'radio'}
                        name={`q-${item.id}-${q.id}`}
                        className="mt-1"
                        checked={checked}
                        onChange={() => pick(q.id, option.label, q.multiSelect)}
                      />
                      <span>
                        {isOther ? 'Other…' : option.label}
                        {option.description && (
                          <span className="block text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </label>
                    {isOther && checked && (
                      <Input
                        autoFocus
                        className="mt-1 ml-6 w-[calc(100%-1.5rem)]"
                        placeholder="Type your answer"
                        value={current.other}
                        onChange={(e) =>
                          setSelection((prev) => ({
                            ...prev,
                            [q.id]: { ...current, other: e.target.value },
                          }))
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <Button
        type="submit"
        size="sm"
        disabled={!complete || assistant.running || assistant.disabled}
      >
        Send answers
      </Button>
    </form>
  );
}
