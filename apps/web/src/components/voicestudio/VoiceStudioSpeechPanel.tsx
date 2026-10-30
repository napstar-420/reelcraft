import { useVoiceStudioStatus, VoiceStudioStatus } from './VoiceStudioStatus';
import { voiceStudioReady } from './voicestudio.logic';

/** Above a VoiceStudio speech stage's models: whether VoiceStudio can be used, and how to add voices. */
export function VoiceStudioSpeechPanel() {
  const status = useVoiceStudioStatus();
  return (
    <div className="flex flex-col gap-2">
      {!voiceStudioReady(status.data) ? <VoiceStudioStatus /> : null}
      <p className="text-xs text-muted-foreground">
        Each engine installed in VoiceStudio is a model here; install more in VoiceStudio’s Model
        Catalogue. To speak in a voice of your own, open the channel’s Library and choose{' '}
        <span className="font-medium">Make a VoiceStudio voice</span> on a recording.
      </p>
    </div>
  );
}
