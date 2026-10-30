/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_KAKAO_MAP_JS_KEY?: string
  readonly VITE_EMAIL_OTP_LENGTH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
