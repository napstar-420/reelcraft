import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from 'cn';
import type { CapabilityDto } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { capabilityStyle } from './capability-style';
import { StagePalette } from './stage-palette';
import { capabilityGroup } from './stage-card.logic';

/** Picks the type of a new stage: the searchable list on the left, what the highlighted type
 * does on the right, and a way to describe the stage to the assistant instead. */
export function AddStageDialog({
  open,
  onOpenChange,
  capabilities,
  loading,
  contextLabel,
  adding,
  onPick,
  onDescribe,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  capabilities: CapabilityDto[];
  loading: boolean;
  /** Where the stage will land, e.g. "after Scene images". */
  contextLabel: string;
  adding: boolean;
  onPick: (capability: CapabilityDto) => void;
  onDescribe: () => void;
}) {
  const [active, setActive] = useState<CapabilityDto | undefined>();
  const style = active ? capabilityStyle(active.key) : null;
  const Icon = style?.icon;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex h-[min(620px,calc(100vh-2rem))] w-[min(820px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[18px] border border-line-strong bg-popover shadow-[0_40px_120px_-20px_rgba(0,0,0,0.7)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center gap-3 border-b px-[18px] py-3.5">
            <DialogPrimitive.Title className="flex-1 text-[17px] font-semibold">
              Add a stage <span className="text-[13px] font-normal text-faint">{contextLabel}</span>
            </DialogPrimitive.Title>
            <Button
              variant="outline"
              size="sm"
              className="border-acc-soft bg-acc-soft text-acc hover:bg-acc-soft"
              onClick={onDescribe}
            >
              <Sparkles /> Describe it instead
            </Button>
          </div>
          <div className="flex min-h-0 flex-1">
            <fieldset
              disabled={adding}
              className="flex w-[360px] min-w-0 shrink-0 flex-col border-r"
            >
              <StagePalette
                capabilities={capabilities}
                loading={loading}
                contextLabel="Arrow keys move, Enter adds."
                onPick={onPick}
                onActiveChange={setActive}
              />
            </fieldset>
            <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-[22px] max-sm:hidden">
              {active && style && Icon ? (
                <>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'flex size-11 items-center justify-center rounded-xl',
                        style.chip,
                        style.ink,
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold">{active.label}</h3>
                      <p className="text-xs text-faint">{capabilityGroup(active.key)}</p>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {active.description}
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Fact label="Kind" value={active.modality} />
                    <Fact
                      label="Runs"
                      value={active.kind === 'async' ? 'In the background' : 'Straight away'}
                    />
                    {active.interaction ? (
                      <Fact
                        label="Needs a person"
                        value={
                          active.interaction.kind === 'form'
                            ? 'Fills in a form'
                            : 'Edits the timeline'
                        }
                      />
                    ) : null}
                    <Fact
                      label="Instructions"
                      value={
                        active.noInstructions
                          ? 'None: fixed work'
                          : active.requiresTemplate
                            ? 'Prompt required'
                            : 'Optional prompt'
                      }
                    />
                  </div>
                  <code className="text-[11px] text-faint">{active.key}</code>
                  <span className="flex-1" />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                      Cancel
                    </Button>
                    <Button disabled={adding} onClick={() => onPick(active)}>
                      <Plus /> Add {contextLabel}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Pick a stage type on the left.</p>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] bg-surface-2 px-3 py-2.5">
      <span className="text-xs text-faint">{label}</span>
      <span className="text-[13px] font-medium">{value}</span>
    </div>
  );
}
