import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRightIcon, Loader2Icon } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { apiErrorMessage } from '@/lib/api-error-message';
import { QWEN_MODELS_KEY, QWEN_SETUP_KEY } from './qwen-setup.logic';

/**
 * Use model files the user already has, where they are. A browser can't hand over a folder's path, so
 * it is typed; the service checks the file names and sizes and says what is missing.
 */
export function QwenLinkFolder({ modelId, modelLabel }: { modelId: string; modelLabel: string }) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState('');
  const link = useMutation({
    mutationFn: () => api.linkQwenModel(modelId, path.trim()),
    onSuccess: () => {
      setPath('');
      void queryClient.invalidateQueries({ queryKey: QWEN_MODELS_KEY });
      void queryClient.invalidateQueries({ queryKey: QWEN_SETUP_KEY });
    },
  });

  return (
    <Collapsible className="flex flex-col gap-1.5">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="group self-start px-1 text-xs">
          <ChevronRightIcon className="transition-transform group-data-[state=open]:rotate-90" />
          Already have the files?
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Enter the full path of the folder with {modelLabel}’s files (config.json,
          model.safetensors…). They are used where they are: nothing is copied or changed. If
          Reelcraft runs in Docker, the folder must be shared with the container, and the path is
          the one inside it.
        </p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (path.trim()) link.mutate();
          }}
        >
          <Input
            value={path}
            placeholder="/Users/me/models/Qwen3-TTS"
            spellCheck={false}
            aria-label={`Folder with ${modelLabel}'s files`}
            onChange={(event) => setPath(event.target.value)}
            className="min-w-56 flex-1 font-mono text-xs"
          />
          <Button type="submit" size="sm" disabled={!path.trim() || link.isPending}>
            {link.isPending ? <Loader2Icon className="animate-spin" /> : null}
            Check folder
          </Button>
        </form>
        {link.isError && (
          <p className="text-xs text-destructive">
            {apiErrorMessage(link.error, 'That folder could not be used.')}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
