/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GH_OAUTH_CLIENT_ID?: string;
  readonly VITE_GH_OAUTH_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** App version injected from package.json at build time (see vite.config.ts). */
declare const __APP_VERSION__: string;
