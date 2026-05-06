import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./pages/Dashboard";
import { GamesPage } from "./pages/Games";
import { TopOnlinePage } from "./pages/TopOnline";
import { GenresPage } from "./pages/charts/Genres";
import { PlatformsPage } from "./pages/charts/Platforms";
import { TagsPage } from "./pages/charts/Tags";
import { AntiCheatPage } from "./pages/charts/AntiCheat";
import { ReviewsPage } from "./pages/charts/Reviews";
import { LanguagesPage } from "./pages/charts/Languages";
import { TimePage } from "./pages/charts/Time";
import { PlayersPage } from "./pages/charts/Players";
import { DrmPage } from "./pages/charts/Drm";
import { HealthPage } from "./pages/Health";
import { ActivityPage } from "./pages/Activity";
import { AddPage } from "./pages/Add";
import { AboutPage } from "./pages/About";
import { SettingsPage } from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="games" element={<GamesPage />} />
        <Route path="games/:appid" element={<GamesPage />} />
        <Route path="top-online" element={<TopOnlinePage />} />
        <Route path="charts">
          <Route index element={<Navigate to="/charts/genres" replace />} />
          <Route path="genres" element={<GenresPage />} />
          <Route path="platforms" element={<PlatformsPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="anti-cheat" element={<AntiCheatPage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="languages" element={<LanguagesPage />} />
          <Route path="time" element={<TimePage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="drm" element={<DrmPage />} />
        </Route>
        <Route path="health" element={<HealthPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="add" element={<AddPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
