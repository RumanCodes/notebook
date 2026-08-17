/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface GoogleCredentialResponse {
  credential: string;
  select_by: string;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize(config: { client_id: string; callback: (response: GoogleCredentialResponse) => void; auto_select?: boolean }): void;
        renderButton(parent: HTMLElement, options: Record<string, string | number | boolean>): void;
        disableAutoSelect(): void;
      };
    };
  };
}
