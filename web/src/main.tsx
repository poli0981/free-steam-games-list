import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";
import { ConsentGate } from "./components/common/ConsentGate";
import { initI18n } from "./i18n";
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

function renderApp() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
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
          </HashRouter>
        </QueryClientProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

// Await i18n (incl. the lazy locale bundle) before first render so t() never
// flashes raw keys. `.finally` guarantees render even if init rejects — en
// resources are bundled, so the app still works in the fallback language.
// Async bootstrap instead of top-level await: build.target is es2020.
initI18n()
  .catch((err) => console.error("[i18n] init failed:", err))
  .finally(renderApp);
