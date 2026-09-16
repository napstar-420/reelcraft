import { Routes, Route, Link } from 'react-router-dom';
import { ChannelsPage } from './pages/ChannelsPage';
import { BlueprintsPage } from './pages/BlueprintsPage';
import { RunPage } from './pages/RunPage';

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
      </Routes>
    </div>
  );
}
