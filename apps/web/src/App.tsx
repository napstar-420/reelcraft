import { lazy, Suspense } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { ChannelsPage } from './pages/ChannelsPage';
import { BlueprintsPage } from './pages/BlueprintsPage';
import { BlueprintCanvasPage } from './pages/BlueprintCanvasPage';
import { RunPage } from './pages/RunPage';
import { EditorPage } from './pages/EditorPage';
import { AppShell } from './components/app-shell';
import { Skeleton } from './components/ui/skeleton';

const TimelineEditorPage = lazy(() =>
  import('./pages/TimelineEditorPage').then((module) => ({ default: module.TimelineEditorPage })),
);

/** The timeline editor renders its own full-bleed layout (media bin, player,
 * tracks) and shouldn't be constrained by the shell's sidebar/breadcrumb —
 * every other route renders inside `AppShell`. */
function RoutedShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const fullBleed = location.pathname.includes('/stages/');
  return fullBleed ? <>{children}</> : <AppShell>{children}</AppShell>;
}

export function App() {
  return (
    <RoutedShell>
      <Routes>
        <Route path="/" element={<ChannelsPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/channels/:channelId" element={<BlueprintsPage />} />
        <Route path="/channels/:channelId/build" element={<BlueprintCanvasPage />} />
        <Route path="/blueprints/:blueprintId/build" element={<BlueprintCanvasPage />} />
        <Route path="/runs/:runId" element={<RunPage />} />
        <Route
          path="/runs/:runId/stages/:stageKey/edit"
          element={
            <Suspense fallback={<Skeleton className="h-screen w-full" />}>
              <TimelineEditorPage />
            </Suspense>
          }
        />
      </Routes>
    </RoutedShell>
  );
}
