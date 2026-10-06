import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CreateBlueprintForm } from '../components/canvas/create-blueprint-form';
import { EditBlueprintCanvas } from '../components/canvas/edit-blueprint-canvas';

/** Route → load-or-create → the blueprint workbench. With a channel and no
 * blueprint it asks for a name first, then hands over to the
 * canvas without a navigation. */
export function BlueprintCanvasPage() {
  const { channelId, blueprintId } = useParams<{ channelId?: string; blueprintId?: string }>();
  const [createdBlueprintId, setCreatedBlueprintId] = useState<string | null>(null);

  const effectiveBlueprintId = blueprintId ?? createdBlueprintId;
  if (effectiveBlueprintId) {
    return <EditBlueprintCanvas blueprintId={effectiveBlueprintId} />;
  }
  if (channelId) {
    return <CreateBlueprintForm channelId={channelId} onCreated={setCreatedBlueprintId} />;
  }
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">Missing channel or blueprint id.</p>
    </div>
  );
}
