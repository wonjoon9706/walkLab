import { afterEach, describe, expect, it, vi } from 'vitest'
import { isKakaoTransitEnabled, isRemoteDeployment } from './localTransitAuth.js'

afterEach(() => vi.unstubAllEnvs())

describe('카카오 운영 허용 정책', () => {
  it.each(['production', 'preview'])('%s는 명시적인 서버 플래그만 허용한다', (env) => {
    vi.stubEnv('VERCEL_ENV', env)
    vi.stubEnv('KAKAO_TRANSIT_PRODUCTION_ENABLED', '')
    expect(isRemoteDeployment()).toBe(true)
    expect(isKakaoTransitEnabled()).toBe(false)
    vi.stubEnv('KAKAO_TRANSIT_PRODUCTION_ENABLED', 'TRUE')
    expect(isKakaoTransitEnabled()).toBe(false)
    vi.stubEnv('KAKAO_TRANSIT_PRODUCTION_ENABLED', 'true')
    expect(isKakaoTransitEnabled()).toBe(true)
  })

  it('로컬 개발은 허용하고 VERCEL_ENV가 없어도 production은 닫는다', () => {
    vi.stubEnv('VERCEL_ENV', 'development')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('KAKAO_TRANSIT_PRODUCTION_ENABLED', '')
    expect(isKakaoTransitEnabled()).toBe(true)
    vi.stubEnv('NODE_ENV', 'production')
    expect(isKakaoTransitEnabled()).toBe(false)
  })
})
