/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUDIT_CAPTURE_ENABLED?: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.yaml?raw" {
  const content: string;
  export default content;
}
