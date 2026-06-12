import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./pages/Dashboard";
import { lazyWithRetry } from "./lib/lazy";

// Dashboard (the landing page) and Layout stay eager — splitting them would
// just add a request waterfall to the first paint. Everything else loads on
// navigation; Layout's <Suspense> keeps the shell mounted meanwhile.
const GamesPage = lazyWithRetry(() =>
  import("./pages/Games").then((m) => ({ default: m.GamesPage })),
);
const TopOnlinePage = lazyWithRetry(() =>
  import("./pages/TopOnline").then((m) => ({ default: m.TopOnlinePage })),
);
const TopOfflinePage = lazyWithRetry(() =>
  import("./pages/TopOffline").then((m) => ({ default: m.TopOfflinePage })),
);
const GenresPage = lazyWithRetry(() =>
  import("./pages/charts/Genres").then((m) => ({ default: m.GenresPage })),
);
const PlatformsPage = lazyWithRetry(() =>
  import("./pages/charts/Platforms").then((m) => ({ default: m.PlatformsPage })),
);
const TagsPage = lazyWithRetry(() =>
  import("./pages/charts/Tags").then((m) => ({ default: m.TagsPage })),
);
const AntiCheatPage = lazyWithRetry(() =>
  import("./pages/charts/AntiCheat").then((m) => ({ default: m.AntiCheatPage })),
);
const AntiCheatListPage = lazyWithRetry(() =>
  import("./pages/AntiCheatList").then((m) => ({ default: m.AntiCheatListPage })),
);
const ReviewsPage = lazyWithRetry(() =>
  import("./pages/charts/Reviews").then((m) => ({ default: m.ReviewsPage })),
);
const LanguagesPage = lazyWithRetry(() =>
  import("./pages/charts/Languages").then((m) => ({ default: m.LanguagesPage })),
);
const TimePage = lazyWithRetry(() =>
  import("./pages/charts/Time").then((m) => ({ default: m.TimePage })),
);
const PlayersPage = lazyWithRetry(() =>
  import("./pages/charts/Players").then((m) => ({ default: m.PlayersPage })),
);
const DrmPage = lazyWithRetry(() =>
  import("./pages/charts/Drm").then((m) => ({ default: m.DrmPage })),
);
const DelistedPage = lazyWithRetry(() =>
  import("./pages/charts/Delisted").then((m) => ({ default: m.DelistedPage })),
);
const HealthPage = lazyWithRetry(() =>
  import("./pages/Health").then((m) => ({ default: m.HealthPage })),
);
const ActivityPage = lazyWithRetry(() =>
  import("./pages/Activity").then((m) => ({ default: m.ActivityPage })),
);
const AddPage = lazyWithRetry(() =>
  import("./pages/Add").then((m) => ({ default: m.AddPage })),
);
const AboutPage = lazyWithRetry(() =>
  import("./pages/About").then((m) => ({ default: m.AboutPage })),
);
const DonatePage = lazyWithRetry(() =>
  import("./pages/Donate").then((m) => ({ default: m.DonatePage })),
);
const SettingsPage = lazyWithRetry(() =>
  import("./pages/Settings").then((m) => ({ default: m.SettingsPage })),
);
const ErrorCodePage = lazyWithRetry(() =>
  import("./pages/errors/ErrorCodeRoute").then((m) => ({ default: m.ErrorCodeRoute })),
);
const NotFoundPage = lazyWithRetry(() =>
  import("./pages/errors/NotFound").then((m) => ({ default: m.NotFoundPage })),
);

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="games" element={<GamesPage />} />
        <Route path="games/:appid" element={<GamesPage />} />
        <Route path="top-online" element={<TopOnlinePage />} />
        <Route path="top-offline" element={<TopOfflinePage />} />
        <Route path="charts">
          <Route index element={<Navigate to="/charts/genres" replace />} />
          <Route path="genres" element={<GenresPage />} />
          <Route path="platforms" element={<PlatformsPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="anti-cheat" element={<AntiCheatPage />} />
          <Route path="anti-cheat/list" element={<AntiCheatListPage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="languages" element={<LanguagesPage />} />
          <Route path="time" element={<TimePage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="drm" element={<DrmPage />} />
          <Route path="delisted" element={<DelistedPage />} />
        </Route>
        <Route path="health" element={<HealthPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="add" element={<AddPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="donate" element={<DonatePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="error/:code" element={<ErrorCodePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
