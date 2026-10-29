import { describe, expect, it } from 'vitest'
import {
  findMissingEnvironmentVariables,
  readPublicEnvironment,
} from './env'

describe('공개 환경변수', () => {
  it('환경변수가 없어도 안전한 기본값을 반환한다', () => {
    const environment = readPublicEnvironment({})

    expect(environment).toEqual({
      supabaseUrl: null,
      supabasePublishableKey: null,
      mapStyleUrl: null,
      mapTilerApiKey: null,
      emailOtpLength: 6,
    })
  })

  it('누락된 외부 서비스 환경변수 이름을 알려준다', () => {
    const environment = readPublicEnvironment({})

    expect(findMissingEnvironmentVariables(environment)).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'VITE_MAP_STYLE_URL',
      'VITE_MAPTILER_API_KEY',
    ])
  })

  it('허용 범위를 벗어난 OTP 길이는 기본값으로 처리한다', () => {
    const environment = readPublicEnvironment({
      VITE_EMAIL_OTP_LENGTH: '20',
    })

    expect(environment.emailOtpLength).toBe(6)
  })
})
