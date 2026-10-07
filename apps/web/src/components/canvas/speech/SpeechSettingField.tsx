import { useQuery } from '@tanstack/react-query';
import { RotateCcwIcon, PlusIcon, XIcon } from 'lucide-react';
import type {
  PronunciationDictionaryRef,
  PronunciationEntry,
  SpeechSetting,
} from '@reelcraft/shared';
import { api } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { InfoLabel } from '../info-label';
import { formatSlider } from './speech-settings.logic';

const DEFAULT = '__default__';

type FieldProps<S extends SpeechSetting> = {
  setting: S;
  /** The saved value, or undefined while the setting is left at the model's default. */
  value: unknown;
  /** Undefined puts the setting back to the model's default. */
  onChange: (value: unknown) => void;
};

function Header({
  setting,
  display,
  onReset,
}: {
  setting: SpeechSetting;
  display?: string;
  onReset?: (() => void) | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <InfoLabel info={setting.description ?? setting.label}>{setting.label}</InfoLabel>
      <span className="flex items-center gap-1.5">
        {display && <span className="text-xs text-muted-foreground tabular-nums">{display}</span>}
        {onReset && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Reset ${setting.label}`}
            title="Back to the default"
            onClick={onReset}
          >
            <RotateCcwIcon />
          </Button>
        )}
      </span>
    </div>
  );
}

function SliderField({
  setting,
  value,
  onChange,
}: FieldProps<Extract<SpeechSetting, { kind: 'slider' }>>) {
  const current = typeof value === 'number' ? value : setting.default;
  return (
    <div className="flex flex-col gap-2">
      <Header
        setting={setting}
        display={formatSlider(current, setting.step)}
        onReset={value === undefined ? undefined : () => onChange(undefined)}
      />
      <Slider
        aria-label={setting.label}
        min={setting.min}
        max={setting.max}
        step={setting.step}
        value={[current]}
        onValueChange={([next]) => {
          if (next === undefined) return;
          // Rounded to the step so a float never drifts into the saved value.
          const rounded = Number((Math.round(next / setting.step) * setting.step).toFixed(4));
          onChange(rounded === setting.default ? undefined : rounded);
        }}
      />
      {(setting.lowLabel || setting.highLabel) && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{setting.lowLabel}</span>
          <span>{setting.highLabel}</span>
        </div>
      )}
    </div>
  );
}

function ChoiceField({
  setting,
  value,
  onChange,
}: FieldProps<Extract<SpeechSetting, { kind: 'choice' }>>) {
  const chosen = setting.options.find((option) => option.value === value);
  const fallback = setting.options.find((option) => option.value === setting.default);
  return (
    <div className="flex flex-col gap-1.5">
      <Header setting={setting} />
      <Select
        value={chosen ? String(chosen.value) : DEFAULT}
        onValueChange={(next) => {
          if (next === DEFAULT) return onChange(undefined);
          const option = setting.options.find((o) => String(o.value) === next);
          onChange(option && option.value === setting.default ? undefined : option?.value);
        }}
      >
        <SelectTrigger size="sm" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>
            {fallback ? `Default (${fallback.label})` : 'Default'}
          </SelectItem>
          {setting.options.map((option) => (
            <SelectItem key={String(option.value)} value={String(option.value)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SwitchField({
  setting,
  value,
  onChange,
}: FieldProps<Extract<SpeechSetting, { kind: 'switch' }>>) {
  const checked = typeof value === 'boolean' ? value : setting.default;
  return (
    <div className="flex items-center gap-2">
      <Switch
        size="sm"
        aria-label={setting.label}
        checked={checked}
        onCheckedChange={(next) => onChange(next === setting.default ? undefined : next)}
      />
      <InfoLabel info={setting.description ?? setting.label}>{setting.label}</InfoLabel>
    </div>
  );
}

function IntegerField({
  setting,
  value,
  onChange,
}: FieldProps<Extract<SpeechSetting, { kind: 'integer' }>>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Header setting={setting} />
      <Input
        type="number"
        className="w-56"
        step={1}
        {...(setting.min !== undefined && { min: setting.min })}
        {...(setting.max !== undefined && { max: setting.max })}
        {...(setting.placeholder && { placeholder: setting.placeholder })}
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => {
          const next = e.target.value === '' ? undefined : Math.trunc(Number(e.target.value));
          onChange(next === undefined || Number.isNaN(next) ? undefined : next);
        }}
      />
    </div>
  );
}

function TextField({
  setting,
  value,
  onChange,
}: FieldProps<Extract<SpeechSetting, { kind: 'text' }>>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Header setting={setting} />
      <Input
        type="text"
        className="w-56"
        {...(setting.placeholder && { placeholder: setting.placeholder })}
        {...(setting.maxLength && { maxLength: setting.maxLength })}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </div>
  );
}

function PronunciationsField({
  setting,
  value,
  onChange,
}: FieldProps<Extract<SpeechSetting, { kind: 'pronunciations' }>>) {
  const rows: PronunciationEntry[] = Array.isArray(value) ? (value as PronunciationEntry[]) : [];
  // Half-filled rows are kept so typing isn't interrupted; the blueprint check flags them until they are done.
  const update = (next: PronunciationEntry[]) => onChange(next.length ? next : undefined);
  return (
    <div className="flex flex-col gap-2">
      <Header setting={setting} />
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            aria-label="Word"
            className="w-28"
            placeholder="word"
            value={row.word}
            onChange={(e) =>
              update(rows.map((r, i) => (i === index ? { ...r, word: e.target.value } : r)))
            }
          />
          <Input
            aria-label="Pronunciation in IPA"
            className="min-w-0 flex-1"
            placeholder="IPA, e.g. ˈsiːkwəl"
            value={row.ipa}
            onChange={(e) =>
              update(rows.map((r, i) => (i === index ? { ...r, ipa: e.target.value } : r)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Remove pronunciation"
            onClick={() => update(rows.filter((_, i) => i !== index))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      {rows.length < setting.max && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => update([...rows, { word: '', ipa: '' }])}
        >
          <PlusIcon /> Add pronunciation
        </Button>
      )}
    </div>
  );
}

function DictionariesField({
  setting,
  value,
  onChange,
  providerId,
}: FieldProps<Extract<SpeechSetting, { kind: 'dictionaries' }>> & { providerId: string }) {
  const chosen: PronunciationDictionaryRef[] = Array.isArray(value)
    ? (value as PronunciationDictionaryRef[])
    : [];
  const dictionaries = useQuery({
    queryKey: ['pronunciation-dictionaries', providerId],
    queryFn: () => api.listPronunciationDictionaries(providerId),
    retry: false,
  });
  const list = dictionaries.data?.dictionaries ?? [];
  const toggle = (dictionary: PronunciationDictionaryRef, on: boolean) => {
    const rest = chosen.filter((d) => d.id !== dictionary.id);
    const next = on ? [...rest, dictionary] : rest;
    onChange(next.length ? next : undefined);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Header setting={setting} />
      {dictionaries.isPending && <p className="text-xs text-muted-foreground">Loading…</p>}
      {dictionaries.isError && (
        <p className="text-xs text-muted-foreground">
          Couldn’t load your dictionaries:{' '}
          {apiErrorMessage(dictionaries.error, 'the request failed')}
        </p>
      )}
      {dictionaries.isSuccess && list.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Your account has no pronunciation dictionaries. Create one in ElevenLabs first.
        </p>
      )}
      {list.map((dictionary) => {
        const on = chosen.some((d) => d.id === dictionary.id);
        const full = !on && chosen.length >= setting.max;
        return (
          <label key={dictionary.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={on}
              disabled={full}
              onCheckedChange={(next) => toggle(dictionary, next === true)}
            />
            {dictionary.name ?? dictionary.id}
          </label>
        );
      })}
      {chosen.length >= setting.max && (
        <p className="text-xs text-muted-foreground">At most {setting.max} at a time.</p>
      )}
    </div>
  );
}

/** One control of a speech model's settings, drawn from the model's own description of it. */
export function SpeechSettingField({
  setting,
  value,
  onChange,
  providerId,
}: FieldProps<SpeechSetting> & { providerId: string }) {
  switch (setting.kind) {
    case 'slider':
      return <SliderField setting={setting} value={value} onChange={onChange} />;
    case 'choice':
      return <ChoiceField setting={setting} value={value} onChange={onChange} />;
    case 'switch':
      return <SwitchField setting={setting} value={value} onChange={onChange} />;
    case 'integer':
      return <IntegerField setting={setting} value={value} onChange={onChange} />;
    case 'text':
      return <TextField setting={setting} value={value} onChange={onChange} />;
    case 'pronunciations':
      return <PronunciationsField setting={setting} value={value} onChange={onChange} />;
    case 'dictionaries':
      return (
        <DictionariesField
          setting={setting}
          value={value}
          onChange={onChange}
          providerId={providerId}
        />
      );
  }
}
