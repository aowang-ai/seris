/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERIS_GATEWAY_URL?: string;
  readonly VITE_SERIS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
