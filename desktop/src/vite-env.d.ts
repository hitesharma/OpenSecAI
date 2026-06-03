/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENSECAI_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
