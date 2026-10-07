import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRightIcon } from 'lucide-react';
import type { PartialModelPin, SpeechSetting } from '@reelcraft/shared';
import { api } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { providerName } from '@/lib/display-names';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InfoHeading, InfoLabel } from '../info-label';
import { SpeechModelCards } from './SpeechModelCards';
import { SpeechSettingField } from './SpeechSettingField';
import { VoicePicker } from './VoicePicker';
import {
  formatUsd,
  groupFormats,
  nextSpeechPin,
  nextSpeechPinForProvider,
  speechOptionsOf,
  withPinParam,
  withVoice,
} from './speech-settings.logic';

const UNSET = '__unset__';

/**
 * The model editor of a Generate Speech stage (or a speech default): the
 * provider, the model, the voice and every setting that model supports. The
 * settings come from the model itself, so each shows only what it can do.
 */
export function SpeechEditor({
  value,
  onChange,
  clearable = true,
}: {
  value: PartialModelPin | undefined;
  onChange: (pin: PartialModelPin | undefined) => void;
  clearable?: boolean;
}) {
  const providers = useQuery({
    queryKey: ['providers', 'audio'],
    queryFn: () => api.listProviders('audio'),
  });
  const provider = value?.provider ?? '';
  const models = useQuery({
    queryKey: ['provider-models', provider],
    queryFn: () => api.listModelsForProvider(provider),
    enabled: !!provider,
  });
  const [choosing, setChoosing] = useState(false);
  const speechModels = models.data?.filter((m) => m.modalities.includes('audio'));
  const model = speechModels?.find((m) => m.modelId === value?.modelId);
  const options = speechOptionsOf(model);
  const params = value?.params;

  const voiceId = typeof params?.voiceId === 'string' ? params.voiceId : undefined;
  const voice = voiceId
    ? {
        id: voiceId,
        name: typeof params?.voiceName === 'string' ? params.voiceName : voiceId,
      }
    : undefined;
  const setParam = (key: string, next: unknown) => onChange(withPinParam(value, key, next));

  const mainSettings = options?.settings.filter((s) => !s.advanced) ?? [];
  const advancedSettings = options?.settings.filter((s) => s.advanced) ?? [];
  const price = params?.pricePerCharacterUsd;
  const field = (setting: SpeechSetting) => (
    <SpeechSettingField
      key={setting.key}
      setting={setting}
      value={params?.[setting.key]}
      onChange={(next) => setParam(setting.key, next)}
      providerId={provider}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Which service turns the text into speech. Changing it clears the model, voice and settings below, since each service has its own.">
          Provider
        </InfoLabel>
        <Select
          value={provider || UNSET}
          onValueChange={(next) =>
            onChange(nextSpeechPinForProvider(next === UNSET ? undefined : next))
          }
        >
          <SelectTrigger size="sm" className="w-56">
            <SelectValue placeholder="Select a provider…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Select a provider…</SelectItem>
            {providers.data?.map((id) => (
              <SelectItem key={id} value={id}>
                {providerName(id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {provider && (
        <div className="flex flex-col gap-1.5">
          <InfoLabel info="The speech model. Newer models sound more natural and expressive; cheaper ones are faster.">
            Model
          </InfoLabel>
          {models.isPending && <p className="text-xs text-muted-foreground">Loading models…</p>}
          {models.isError && (
            <p className="text-xs text-destructive">
              Couldn’t load the models: {apiErrorMessage(models.error, 'the request failed')}
            </p>
          )}
          {speechModels && speechModels.length === 0 && (
            <p className="text-xs text-destructive">
              {models.data?.[0]?.unavailableModalities?.audio ??
                'This provider has no speech models available.'}
            </p>
          )}
          {speechModels && speechModels.length > 0 && (
            <>
              <SpeechModelCards
                models={model && !choosing ? [model] : speechModels}
                selected={value?.modelId}
                onSelect={(next) => {
                  onChange(nextSpeechPin(value, next));
                  setChoosing(false);
                }}
              />
              {model && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setChoosing((open) => !open)}
                >
                  {choosing ? 'Keep this model' : 'Change model'}
                </Button>
              )}
            </>
          )}
          {speechModels && value?.modelId && !model && (
            <p className="text-xs text-destructive">
              “{value.modelId}” isn’t offered by {providerName(provider)}. Pick one of the models
              above.
            </p>
          )}
        </div>
      )}

      {model && !options && (
        <p className="text-xs text-muted-foreground">
          This model needs no voice or settings. It makes placeholder audio.
        </p>
      )}

      {model && options && (
        <>
          {options.voices === 'library' && (
            <div className="flex flex-col gap-1.5">
              <InfoLabel info="Who reads the text. Play a sample before you choose. Until you choose one, the model's default voice is used.">
                Voice
              </InfoLabel>
              <VoicePicker
                providerId={provider}
                modelId={model.modelId}
                voice={voice}
                defaultVoice={options.defaultVoice}
                onChange={(next) => onChange(withVoice(value, next))}
              />
              {!voice && !options.defaultVoice && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Choose a voice. Voices belong to your account, so there is no default.
                </p>
              )}
            </div>
          )}

          {mainSettings.map(field)}

          <div className="flex flex-col gap-1.5">
            <InfoLabel info="The audio file the stage makes. MP3 is the smallest; WAV and FLAC keep every detail.">
              Output format
            </InfoLabel>
            <Select
              value={typeof params?.outputFormat === 'string' ? params.outputFormat : UNSET}
              onValueChange={(next) => setParam('outputFormat', next === UNSET ? undefined : next)}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>
                  Default ({options.formats.find((f) => f.value === options.defaultFormat)?.group}{' '}
                  {options.formats.find((f) => f.value === options.defaultFormat)?.label})
                </SelectItem>
                {groupFormats(options.formats).map(({ group, formats }) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {formats.map((format) => (
                      <SelectItem key={format.value} value={format.value}>
                        {format.label}
                        {format.note && ` (${format.note})`}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            About {formatUsd(options.pricePerKCharsUsd)} per 1,000 characters
            {options.audioTags &&
              '. This model reads delivery tags such as [whispers] in the text.'}
          </p>

          <Collapsible className="flex flex-col gap-3">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="group self-start px-1">
                <ChevronRightIcon className="transition-transform group-data-[state=open]:rotate-90" />
                Advanced
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-4">
              {advancedSettings.map(field)}
              <div className="flex flex-col gap-1.5">
                <InfoHeading info="Reelcraft estimates the cost from the provider's list price. If your plan charges differently, enter the price here and the estimate and budget checks follow it.">
                  Price per 1,000 characters
                </InfoHeading>
                <Input
                  type="number"
                  className="w-56"
                  min={0}
                  step="any"
                  placeholder={String(options.pricePerKCharsUsd)}
                  value={typeof price === 'number' ? Number((price * 1000).toFixed(6)) : ''}
                  onChange={(e) => {
                    const dollars = e.target.value === '' ? undefined : Number(e.target.value);
                    setParam(
                      'pricePerCharacterUsd',
                      dollars === undefined || !Number.isFinite(dollars) || dollars < 0
                        ? undefined
                        : dollars / 1000,
                    );
                  }}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}

      {clearable && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => onChange(undefined)}
        >
          Unset model
        </Button>
      )}
    </div>
  );
}
