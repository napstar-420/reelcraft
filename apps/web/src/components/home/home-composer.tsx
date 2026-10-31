import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowUp, FolderClosed, Layers, Loader2 } from 'lucide-react';
import type { ChannelDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BlueprintWithChannel } from '@/hooks/useAllBlueprints';
import { apiErrorMessage } from '@/lib/api-error-message';
import { askInBlueprintUrl, blueprintNameFromPrompt } from '@/lib/assistant-handoff';
import { loadAssistantPrefs, saveAssistantPrefs } from '@/lib/assistant-prefs';

const NEW = '__new__';

export type ComposerPreset = { text: string; blueprintId?: string | undefined };

const CHIP =
  'h-[30px] w-auto gap-1.5 border-border text-[13px] text-muted-foreground hover:text-foreground';

/** Home's message box. The assistant works inside a blueprint, so sending opens the chosen
 * blueprint (or a new one in the chosen channel) with the message for its assistant. */
export function HomeComposer({
  channels,
  blueprints,
  preset,
  autoFocus,
}: {
  channels: ChannelDto[];
  blueprints: BlueprintWithChannel[];
  preset: ComposerPreset | null;
  autoFocus: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [channelId, setChannelId] = useState<string | undefined>(
    () => loadAssistantPrefs().channelId,
  );
  const [blueprintId, setBlueprintId] = useState<string>(NEW);

  const channel = channels.find((c) => c.id === channelId) ?? channels[0];
  const inChannel = useMemo(
    () => blueprints.filter((b) => b.channelId === channel?.id),
    [blueprints, channel?.id],
  );

  useEffect(() => {
    if (!preset) return;
    setText(preset.text);
    const target = blueprints.find((b) => b.id === preset.blueprintId);
    if (target) {
      setChannelId(target.channelId);
      setBlueprintId(target.id);
    }
    area.current?.focus();
  }, [preset, blueprints]);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  const send = useMutation({
    mutationFn: async (message: string) => {
      if (!channel) throw new Error('Create a channel first: blueprints live in a channel.');
      if (blueprintId !== NEW) return { id: blueprintId, message };
      const created = await api.createBlueprint(channel.id, blueprintNameFromPrompt(message));
      void queryClient.invalidateQueries({ queryKey: ['blueprints', channel.id] });
      return { id: created.blueprintId, message };
    },
    onSuccess: ({ id, message }) => navigate(askInBlueprintUrl(id, message)),
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not open the assistant.')),
  });

  function submit() {
    const message = text.trim();
    if (!message || send.isPending) return;
    send.mutate(message);
  }

  return (
    <div className="rounded-[18px] border border-line-strong bg-card p-3.5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
      <label htmlFor="home-ask" className="sr-only">
        Message the assistant
      </label>
      <textarea
        id="home-ask"
        ref={area}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="A 45-second history short about the Library of Alexandria: script, voice-over, 8 illustrated scenes, captions, then publish"
        className="w-full resize-none bg-transparent px-1.5 pt-1.5 pb-3 text-base leading-relaxed outline-none placeholder:text-faint"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={channel?.id ?? ''}
          onValueChange={(id) => {
            setChannelId(id);
            setBlueprintId(NEW);
            saveAssistantPrefs({ channelId: id });
          }}
          disabled={!channels.length}
        >
          <SelectTrigger size="sm" aria-label="Channel" className={CHIP}>
            <FolderClosed className="size-[15px]" />
            <SelectValue placeholder="No channel yet" />
          </SelectTrigger>
          <SelectContent>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={blueprintId} onValueChange={setBlueprintId} disabled={!channel}>
          <SelectTrigger size="sm" aria-label="Blueprint" className={`${CHIP} max-w-64`}>
            <Layers className="size-[15px]" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW}>New blueprint</SelectItem>
            {inChannel.length ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Change an existing one</SelectLabel>
                  {inChannel.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
          </SelectContent>
        </Select>
        <span className="flex-1" />
        <Button
          variant="accent"
          size="sm"
          className="h-[34px] px-3.5"
          disabled={!text.trim() || !channel || send.isPending}
          onClick={submit}
        >
          {send.isPending ? <Loader2 className="animate-spin" /> : null}
          Send
          {!send.isPending ? <ArrowUp /> : null}
        </Button>
      </div>
    </div>
  );
}
