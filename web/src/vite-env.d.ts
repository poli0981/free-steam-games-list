/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GH_OAUTH_CLIENT_ID?: string;
  readonly VITE_GH_OAUTH_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
