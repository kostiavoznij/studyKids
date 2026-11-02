declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Supabase project of this build (see .env.development / .env.production) */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
}
