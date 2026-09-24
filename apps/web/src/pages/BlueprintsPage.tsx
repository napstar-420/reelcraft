import { useParams, useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BlueprintsTab } from '@/components/blueprints/blueprints-tab';
import { CharactersTab } from '@/components/characters/characters-tab';
import { AssetsTab } from '@/components/assets/assets-tab';

export function BlueprintsPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'blueprints';

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Channel</h1>
        <p className="text-sm text-muted-foreground">
          Manage this channel's blueprints, characters, and assets.
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="blueprints">Blueprints</TabsTrigger>
          <TabsTrigger value="characters">Characters</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
        </TabsList>
        <TabsContent value="blueprints">
          <BlueprintsTab channelId={channelId} />
        </TabsContent>
        <TabsContent value="characters">
          <CharactersTab channelId={channelId} />
        </TabsContent>
        <TabsContent value="assets">
          <AssetsTab channelId={channelId} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
