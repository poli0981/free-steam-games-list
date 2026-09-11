import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";
import { ConsentGate } from "./components/common/ConsentGate";
import { initI18n } from "./i18n";
import { installExternalLinkInterceptor } from "./lib/external-link-interceptor";
import { isTauri } from "./lib/external-open";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

/**
 * BrowserRouter on the web, HashRouter inside Tauri.
 *
 * The Tauri webview serves the bundle from its own asset protocol with no
 * server-side fallback, so a real path like /games/730 would 404 on refresh or
 * deep link; hash routes never leave index.html. On the web, the Worker's
 * `not_found_handling: "single-page-application"` provides that fallback, so
 * real paths work — and become shareable and indexable, which #/ URLs are not.
 */
const Router = isTauri() ? HashRouter : BrowserRouter;

/**
 * Every link from the HashRouter era is /#/games/730. Rewrite it to
 * /games/730 BEFORE the router first reads the URL, so bookmarks, shared links
 * and search results keep working. Only `#/…` is rewritten — an in-page anchor
 * such as #vac is left alone. replaceState rather than a navigation, so Back
 * does not bounce the user to the old URL.
 */
function upgradeLegacyHashUrl(): void {
  if (isTauri()) return;
  const { hash } = window.location;
  if (hash.startsWith("#/")) {
    window.history.replaceState(window.history.state, "", hash.slice(1) || "/");
  }
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <Router>
            <ConsentGate>
              <App />
            </ConsentGate>
            <Toaster
              richColors
              closeButton
              theme="dark"
              position="bottom-right"
              toastOptions={{
                style: {
                  background: "hsl(var(--card))",
                  color: "hsl(var(--card-foreground))",
                  border: "1px solid hsl(var(--border))",
                },
              }}
            />
          </Router>
        </QueryClientProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

// Route external <a>/links through the system browser when running inside the
// Tauri webview (no-op on web). Attach before render so the first paint's
// links are already covered.
upgradeLegacyHashUrl();
installExternalLinkInterceptor();

// Await i18n (incl. the lazy locale bundle) before first render so t() never
// flashes raw keys. `.finally` guarantees render even if init rejects — en
// resources are bundled, so the app still works in the fallback language.
// Async bootstrap instead of top-level await: build.target is es2020.
initI18n()
  .catch((err) => console.error("[i18n] init failed:", err))
  .finally(renderApp);
