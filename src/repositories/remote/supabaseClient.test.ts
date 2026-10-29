import { describe, expect, it, vi } from 'vitest'
import { readPublicEnvironment } from '../../app/env'
import { createSupabaseBrowserClient } from './supabaseClient'

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({})),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

describe('Supabase 브라우저 client', () => {
  it('필수 환경변수가 없으면 외부 client를 만들지 않는다', () => {
    const environment = readPublicEnvironment({})

    expect(createSupabaseBrowserClient(environment)).toBeNull()
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('세션 유지 옵션으로 browser client를 준비한다', () => {
    const environment = readPublicEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'example-publishable-key',
    })

    createSupabaseBrowserClient(environment)

    expect(createClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'example-publishable-key',
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      },
    )
  })
})
