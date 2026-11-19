/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API. Defaults to `/api` (proxied to the backend by Vite in development). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
