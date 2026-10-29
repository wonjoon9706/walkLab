/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_MAP_STYLE_URL?: string
  readonly VITE_MAPTILER_API_KEY?: string
  readonly VITE_EMAIL_OTP_LENGTH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
