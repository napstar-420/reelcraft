import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PackageInspectReportDto, PackageSlot } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Dropzone } from '@/components/upload/dropzone';
import { putWithProgress } from '@/components/upload/use-upload';
import { apiErrorMessage } from '@/lib/api-error-message';
import {
  canInstall,
  defaultChoices,
  EXISTING,
  hasBlock,
  signerLabel,
  toBindings,
  type SlotChoice,
} from './import-package.logic';

type Step =
  | { name: 'pick' }
  | { name: 'working'; label: string }
  | { name: 'review'; objectKey: string; report: PackageInspectReportDto };

/** Imports a `.reelpack` into one channel: upload, review what it needs and
 * who made it, fill its slots, then install. */
export function ImportPackageDialog({
  channelId,
  open,
  onOpenChange,
}: {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ name: 'pick' });
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, SlotChoice>>({});
  const [mode, setMode] = useState<'new' | 'update'>('new');
  const [name, setName] = useState('');
  const [runCap, setRunCap] = useState('0');
  const [trust, setTrust] = useState(false);

  const characters = useQuery({
    queryKey: ['characters', channelId],
    queryFn: () => api.listChannelCharacters(channelId),
    enabled: open,
  });
  const assets = useQuery({
    queryKey: ['assets', channelId],
    queryFn: () => api.listChannelAssets(channelId),
    enabled: open,
  });

  // Start fresh each time the dialog opens.
  useEffect(() => {
    if (open) {
      setStep({ name: 'pick' });
      setError(null);
    }
  }, [open]);

  const close = () => {
    if (step.name === 'review') {
      void api.cancelPackageUpload({ objectKey: step.objectKey }).catch(() => undefined);
    }
    onOpenChange(false);
  };

  async function choose(file: File) {
    setError(null);
    try {
      setStep({ name: 'working', label: 'Uploading…' });
      const { uploadUrl, objectKey } = await api.requestPackageUpload();
      await putWithProgress(uploadUrl, file, () => undefined);
      setStep({ name: 'working', label: 'Checking the package…' });
      const report = await api.inspectPackage({ objectKey, channelId });
      setChoices(defaultChoices(report.slots));
      setMode(report.installed?.canUpdate ? 'update' : 'new');
      setName(report.suggestedName ?? '');
      setTrust(false);
      if (hasBlock(report)) {
        void api.cancelPackageUpload({ objectKey }).catch(() => undefined);
      }
      setStep({ name: 'review', objectKey, report });
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not read that file.'));
      setStep({ name: 'pick' });
    }
  }

  const install = useMutation({
    mutationFn: () => {
      if (step.name !== 'review') throw new Error('nothing to install');
      const { report, objectKey } = step;
      return api.installPackage({
        objectKey,
        channelId,
        mode,
        ...(mode === 'update' && report.installed
          ? { targetBlueprintId: report.installed.blueprintId }
          : {}),
        name: name.trim() || report.summary?.name || 'Imported blueprint',
        runCapUsd: Number(runCap),
        bindings: toBindings(report.slots, choices),
        trustAuthor: trust,
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['blueprints', channelId] });
      void queryClient.invalidateQueries({ queryKey: ['characters', channelId] });
      void queryClient.invalidateQueries({ queryKey: ['assets', channelId] });
      void queryClient.invalidateQueries({ queryKey: ['blueprint-versions', result.blueprintId] });
      void queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
      if (result.runnable) toast.success('Blueprint imported');
      else toast.warning('Imported, but it is not runnable yet. Open it to see what to fix.');
      onOpenChange(false);
      navigate(`/blueprints/${result.blueprintId}/build`);
    },
    onError: (err) => setError(apiErrorMessage(err, 'Could not install the package.')),
  });

  const report = step.name === 'review' ? step.report : null;
  const blocked = report ? hasBlock(report) : false;
  const ready =
    report !== null && canInstall({ report, choices, mode, name, runCapUsd: Number(runCap) });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import package</DialogTitle>
          <DialogDescription>
            Add a blueprint someone shared as a .reelpack file to this channel.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {step.name === 'pick' && (
          <Dropzone
            accept=".reelpack"
            onFilesSelected={(files) => files[0] && void choose(files[0])}
          />
        )}
        {step.name === 'working' && (
          <p className="py-6 text-center text-sm text-muted-foreground">{step.label}</p>
        )}

        {report && (
          <div className="flex flex-col gap-4">
            {report.summary && (
              <div className="flex flex-col gap-1">
                <h3 className="font-medium">
                  {report.summary.name}{' '}
                  <span className="font-normal text-muted-foreground">
                    v{report.summary.version}
                  </span>
                </h3>
                {report.summary.description && (
                  <p className="text-sm text-muted-foreground">{report.summary.description}</p>
                )}
                <p className="font-mono text-xs text-muted-foreground">
                  {signerLabel(report.signer)}
                </p>
              </div>
            )}

            <IssueList report={report} />

            {!blocked && report.summary && (
              <>
                {(report.requires.capabilities.length > 0 ||
                  report.requires.providers.length > 0) && (
                  <p className="text-xs text-muted-foreground">
                    Uses {report.requires.capabilities.join(', ') || 'no stages'}
                    {report.requires.providers.length > 0
                      ? `, with ${report.requires.providers.join(', ')}`
                      : ''}
                    .
                  </p>
                )}

                {report.installed && (
                  <div className="flex flex-col gap-2">
                    <Label>
                      “{report.installed.blueprintName}” (v{report.installed.version}) is already in
                      this channel
                    </Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={mode === 'update' ? 'default' : 'outline'}
                        disabled={!report.installed.canUpdate}
                        onClick={() => setMode('update')}
                      >
                        Add as a new version
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={mode === 'new' ? 'default' : 'outline'}
                        onClick={() => setMode('new')}
                      >
                        Install as a separate copy
                      </Button>
                    </div>
                  </div>
                )}

                {report.slots.map((slot) => (
                  <SlotPicker
                    key={slot.key}
                    slot={slot}
                    value={choices[slot.key] ?? ''}
                    onChange={(value) => setChoices((c) => ({ ...c, [slot.key]: value }))}
                    options={
                      slot.kind === 'character'
                        ? (characters.data ?? [])
                            .filter((c) => c.readiness === 'ready')
                            .map((c) => ({ id: c.id, name: c.name }))
                        : (assets.data ?? [])
                            .filter((a) => a.kind === slot.assetKind)
                            .map((a) => ({ id: a.id, name: a.name }))
                    }
                  />
                ))}

                {mode === 'new' && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="import-name">Blueprint name</Label>
                    <Input
                      id="import-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-cap">Run cap (USD)</Label>
                  <Input
                    id="import-cap"
                    type="number"
                    min="0"
                    step="0.5"
                    value={runCap}
                    onChange={(e) => setRunCap(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    The most one run may spend; 0 means no limit. Packages never set this for you.
                  </p>
                </div>

                {report.signer.signed && !report.signer.trusted && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="import-trust"
                      checked={trust}
                      onCheckedChange={(checked) => setTrust(checked === true)}
                    />
                    <Label htmlFor="import-trust">Trust this author from now on</Label>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={install.isPending}>
            {blocked ? 'Close' : 'Cancel'}
          </Button>
          {blocked && (
            <Button variant="outline" onClick={() => setStep({ name: 'pick' })}>
              Choose another file
            </Button>
          )}
          {report && !blocked && (
            <Button onClick={() => install.mutate()} disabled={!ready || install.isPending}>
              {install.isPending ? 'Importing…' : 'Import'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueList({ report }: { report: PackageInspectReportDto }) {
  const blocks = report.issues.filter((i) => i.severity === 'block');
  const warnings = report.issues.filter((i) => i.severity !== 'block');
  return (
    <>
      {blocks.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {blocks.map((issue, i) => (
                <li key={`${issue.code}-${i}`}>{issue.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {warnings.map((issue, i) => (
                <li key={`${issue.code}-${i}`}>{issue.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

function SlotPicker({
  slot,
  value,
  onChange,
  options,
}: {
  slot: PackageSlot;
  value: SlotChoice;
  onChange: (value: SlotChoice) => void;
  options: Array<{ id: string; name: string }>;
}) {
  const noun = slot.kind === 'character' ? 'character' : 'asset';
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {slot.label}{' '}
        <span className="font-normal text-muted-foreground">
          ({noun}
          {slot.required ? '' : ', optional'})
        </span>
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={`Choose a ${noun}…`} />
        </SelectTrigger>
        <SelectContent>
          {slot.bundled && (
            <SelectItem value="bundled">Use “{slot.bundled.name}” from the package</SelectItem>
          )}
          {!slot.required && <SelectItem value="empty">Leave empty</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.id} value={`${EXISTING}${option.id}`}>
              Use my {noun} “{option.name}”
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
