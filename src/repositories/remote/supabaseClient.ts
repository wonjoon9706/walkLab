import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  publicEnvironment,
  type PublicEnvironment,
} from '../../app/env'

export function createSupabaseBrowserClient(
  environment: PublicEnvironment,
): SupabaseClient | null {
  if (
    environment.supabaseUrl === null ||
    environment.supabasePublishableKey === null
  ) {
    return null
  }

  return createClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  )
}

// 환경변수가 없는 초기 개발 환경에서는 외부 요청 없이 앱을 실행한다.
export const supabaseClient = createSupabaseBrowserClient(publicEnvironment)
