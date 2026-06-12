import type { ReactNode } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * Last-resort boundary mounted OUTSIDE the router/providers in main.tsx.
 * Its fallback must not depend on i18n, Tailwind, or react-router — any of
 * them could be the thing that crashed — so it uses inline styles and
 * hardcoded bilingual strings. Background matches the PWA theme_color.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(error) => (
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            background: "#0f172a",
            color: "#e2e8f0",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
            <h1 style={{ fontSize: 18, marginBottom: 8 }}>
              Something went wrong / Đã xảy ra lỗi
            </h1>
            <p style={{ fontSize: 13, opacity: 0.7, wordBreak: "break-word" }}>
              {error.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "#1e293b",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Reload / Tải lại
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
