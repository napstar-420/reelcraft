import { lazy, Suspense } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { ChannelsPage } from './pages/ChannelsPage';
import { BlueprintsPage } from './pages/BlueprintsPage';
import { BlueprintCanvasPage } from './pages/BlueprintCanvasPage';
import { RunPage } from './pages/RunPage';
import { EditorPage } from './pages/EditorPage';

const TimelineEditorPage = lazy(() =>
  import('./pages/TimelineEditorPage').then((module) => ({ default: module.TimelineEditorPage })),
);

export function App() {
  return (
    <div>
      <nav>
        <Link to="/">Channels</Link> <Link to="/editor">Editor</Link>
      </nav>
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
            <Suspense fallback={<p>Loading editor…</p>}>
              <TimelineEditorPage />
            </Suspense>
          }
        />
      </Routes>
    </div>
  );
}
