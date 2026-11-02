import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AssistantNoteDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const MAX_CHARS = 500;

/** What the assistant always knows: global notes (no channel) or one channel's. The assistant
 * adds notes itself when you tell it to remember something; you can add, edit and remove them. */
export function AssistantNotes({ channelId }: { channelId?: string }) {
  const queryClient = useQueryClient();
  const key = ['assistant-notes', channelId ?? 'global'];
  const notes = useQuery({ queryKey: key, queryFn: () => api.listAssistantNotes(channelId) });
  const [draft, setDraft] = useState('');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['assistant-notes'] });
  const add = useMutation({
    mutationFn: (text: string) =>
      api.createAssistantNote(
        channelId ? { scope: 'channel', channelId, text } : { scope: 'global', text },
      ),
    onSuccess: () => {
      setDraft('');
      refresh();
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not save the note.')),
  });

  return (
    <section className="overflow-hidden rounded-[14px] border bg-card">
      <div className="px-[18px] pt-4 pb-3">
        <h3 className="text-[15px] font-semibold">
          {channelId
            ? 'What the assistant remembers about this channel'
            : 'What the assistant remembers'}
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {channelId
            ? 'Given to the assistant whenever a chat is about this channel. Tell it to remember something, or add a note here.'
            : 'Given to the assistant in every chat. Tell it to remember something, or add a note here.'}
        </p>
      </div>
      <div className="space-y-2 px-[18px] pb-4">
        {notes.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : notes.data?.length ? (
          <ul className="divide-y rounded-lg border">
            {notes.data.map((note) => (
              <NoteRow key={note.id} note={note} onChanged={refresh} />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">No notes yet.</p>
        )}
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) add.mutate(draft.trim());
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
            placeholder={
              channelId
                ? 'e.g. Videos here are always 9:16, with a calm female voice'
                : 'e.g. Keep real runs under $2 unless I say otherwise'
            }
            aria-label="New note"
            rows={2}
            className="min-h-10 flex-1 text-[13px]"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!draft.trim() || add.isPending}
          >
            <Plus /> Add
          </Button>
        </form>
      </div>
    </section>
  );
}

function NoteRow({ note, onChanged }: { note: AssistantNoteDto; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const save = useMutation({
    mutationFn: () => api.updateAssistantNote(note.id, text.trim()),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not save the note.')),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteAssistantNote(note.id),
    onSuccess: onChanged,
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not remove the note.')),
  });
  return (
    <li className="flex items-start gap-2 px-3 py-2 text-[13px]">
      {note.source === 'assistant' && (
        <Sparkles
          className="mt-0.5 size-3.5 shrink-0 text-acc"
          aria-label="Saved by the assistant"
        />
      )}
      {editing ? (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
          aria-label="Edit note"
          rows={2}
          className="min-h-10 flex-1 text-[13px]"
          autoFocus
        />
      ) : (
        <span className="flex-1 leading-relaxed">{note.text}</span>
      )}
      <div className="flex shrink-0 gap-0.5">
        {editing ? (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Save"
              disabled={!text.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              <Check />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel"
              onClick={() => (setEditing(false), setText(note.text))}
            >
              <X />
            </Button>
          </>
        ) : (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Edit note"
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Remove note"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
