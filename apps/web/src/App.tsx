import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { BlueprintsPage } from './pages/BlueprintsPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { BlueprintCanvasPage } from './pages/BlueprintCanvasPage';
import { RunsPage } from './pages/RunsPage';
import { RunPage } from './pages/RunPage';
import { EditorPage } from './pages/EditorPage';
import { SettingsPage } from './pages/SettingsPage';
import { AppShell } from './components/app-shell';
import { Skeleton } from './components/ui/skeleton';
import { useLiveUpdates } from './hooks/useLiveUpdates';
import { syncPushFromPrefs } from './lib/push';

const TimelineEditorPage = lazy(() =>
  import('./pages/TimelineEditorPage').then((module) => ({ default: module.TimelineEditorPage })),
);

export function App() {
  useLiveUpdates();
  useEffect(() => {
    void syncPushFromPrefs();
  }, []);
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/blueprints" element={<BlueprintsPage />} />
        <Route path="/blueprints/:blueprintId/build" element={<BlueprintCanvasPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/channels/:channelId" element={<ChannelsPage />} />
        <Route path="/channels/:channelId/build" element={<BlueprintCanvasPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<RunPage />} />
        <Route
          path="/runs/:runId/stages/:stageKey/edit"
          element={
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <TimelineEditorPage />
            </Suspense>
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
