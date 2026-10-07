import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CheckIcon, ChevronDownIcon, PauseIcon, PlayIcon, SearchIcon } from 'lucide-react';
import type { VoiceInfo } from '@reelcraft/shared';
import { api } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ANY = '__any__';

/** Plays one voice sample at a time. */
function useVoicePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );
  function stop() {
    audio.current?.pause();
    setPlaying(null);
  }
  function toggle(voice: VoiceInfo) {
    if (!voice.previewUrl) return;
    if (playing === voice.id) return stop();
    audio.current?.pause();
    const next = new Audio(voice.previewUrl);
    next.onended = () => setPlaying(null);
    next.onerror = () => setPlaying(null);
    audio.current = next;
    setPlaying(voice.id);
    void next.play().catch(() => setPlaying(null));
  }
  return { playing, toggle, stop };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const facts = (voice: VoiceInfo) =>
  [voice.gender, voice.accent, voice.age, voice.languages?.join(', ')].filter(Boolean).join(' · ');

function VoiceRow({
  voice,
  selected,
  playing,
  onPick,
  onPreview,
}: {
  voice: VoiceInfo;
  selected: boolean;
  playing: boolean;
  onPick: () => void;
  onPreview: () => void;
}) {
  return (
    <li className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        className="mt-0.5"
        disabled={!voice.previewUrl}
        aria-label={playing ? `Stop ${voice.name}` : `Play a sample of ${voice.name}`}
        title={voice.previewUrl ? 'Hear a sample' : 'This voice has no sample'}
        onClick={onPreview}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start text-left"
        onClick={onPick}
      >
        <span className="flex w-full items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{voice.name}</span>
          {voice.category && (
            <Badge variant="outline" className="capitalize">
              {voice.category}
            </Badge>
          )}
          {selected && <CheckIcon className="ml-auto size-4 shrink-0" />}
        </span>
        {facts(voice) && (
          <span className="text-xs text-muted-foreground capitalize">{facts(voice)}</span>
        )}
        {voice.description && (
          <span className="line-clamp-2 text-xs text-muted-foreground">{voice.description}</span>
        )}
      </button>
    </li>
  );
}

/** Picks a voice from the provider's voice list, with search, filters and samples. */
export function VoicePicker({
  providerId,
  modelId,
  voice,
  defaultVoice,
  onChange,
}: {
  providerId: string;
  modelId: string;
  /** The saved voice, if any. */
  voice: { id: string; name: string } | undefined;
  defaultVoice: { id: string; name: string } | undefined;
  onChange: (voice: { id: string; name: string } | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState(ANY);
  const [gender, setGender] = useState(ANY);
  const [manualId, setManualId] = useState('');
  const query = useDebounced(search.trim(), 250);
  const preview = useVoicePreview();

  const voices = useInfiniteQuery({
    queryKey: ['voices', providerId, modelId, query, language, gender],
    enabled: open,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.listVoices(providerId, {
        modelId,
        ...(query && { search: query }),
        ...(language !== ANY && { language }),
        ...(gender !== ANY && { gender }),
        ...(pageParam && { cursor: pageParam }),
        limit: 30,
      }),
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  const loaded = useMemo(
    () => voices.data?.pages.flatMap((page) => page.voices) ?? [],
    [voices.data],
  );
  const languages = useMemo(
    () => [...new Set(loaded.flatMap((v) => v.languages ?? []))].sort(),
    [loaded],
  );
  const shown = voice ?? defaultVoice;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) preview.stop();
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-full justify-between">
          <span className="truncate">
            {shown ? shown.name : 'Choose a voice…'}
            {!voice && defaultVoice && <span className="text-muted-foreground"> (default)</span>}
          </span>
          <ChevronDownIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-96 max-w-[90vw] flex-col gap-2 p-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-8"
            placeholder="Search by name, accent or use…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Select value={gender} onValueChange={setGender}>
            <SelectTrigger size="sm" className="flex-1" aria-label="Gender">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any gender</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="male">Male</SelectItem>
            </SelectContent>
          </Select>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger size="sm" className="flex-1" aria-label="Language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any language</SelectItem>
              {language !== ANY && !languages.includes(language) && (
                <SelectItem value={language}>{language}</SelectItem>
              )}
              {languages.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {voices.isPending && (
            <li className="px-2 py-3 text-sm text-muted-foreground">Loading voices…</li>
          )}
          {voices.isError && (
            <li className="flex flex-col gap-2 px-2 py-3 text-sm">
              <span className="text-destructive">
                Couldn’t load voices: {apiErrorMessage(voices.error, 'the request failed')}
              </span>
              <span className="text-muted-foreground">
                {/permission/i.test(apiErrorMessage(voices.error, ''))
                  ? 'Give the key that permission in your provider’s dashboard, or paste a voice ID here.'
                  : 'You can still paste a voice ID from your provider.'}
              </span>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const id = manualId.trim();
                  if (!id) return;
                  onChange({ id, name: id });
                  setOpen(false);
                }}
              >
                <Input
                  aria-label="Voice ID"
                  placeholder="Voice ID"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                />
                <Button type="submit" size="sm" disabled={!manualId.trim()}>
                  Use
                </Button>
              </form>
            </li>
          )}
          {voices.isSuccess && loaded.length === 0 && (
            <li className="px-2 py-3 text-sm text-muted-foreground">No voice matches.</li>
          )}
          {loaded.map((candidate) => (
            <VoiceRow
              key={candidate.id}
              voice={candidate}
              selected={candidate.id === (voice?.id ?? defaultVoice?.id)}
              playing={preview.playing === candidate.id}
              onPick={() => {
                onChange({ id: candidate.id, name: candidate.name });
                setOpen(false);
              }}
              onPreview={() => preview.toggle(candidate)}
            />
          ))}
          {voices.hasNextPage && (
            <li>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={voices.isFetchingNextPage}
                onClick={() => void voices.fetchNextPage()}
              >
                {voices.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
