import { lazy, Suspense } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { ChannelsPage } from './pages/ChannelsPage';
import { BlueprintsPage } from './pages/BlueprintsPage';
import { RunPage } from './pages/RunPage';

const TimelineEditorPage = lazy(() =>
  import('./pages/TimelineEditorPage').then((module) => ({ default: module.TimelineEditorPage })),
);

export function App() {
  return (
    <div>
      <nav>
        <Link to="/">Channels</Link>
      </nav>
      <Routes>
        <Route path="/" element={<ChannelsPage />} />
        <Route path="/channels/:channelId" element={<BlueprintsPage />} />
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
