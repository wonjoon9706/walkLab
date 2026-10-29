import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createAuthService } from './authService'

function createSupabaseUser(): User {
  return {
    id: 'user-123',
    email: 'walker@example.com',
  } as User
}

function createClientMock() {
  const user = createSupabaseUser()
  const auth = {
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({
      data: { user, session: {} },
      error: null,
    }),
    getSession: vi.fn().mockResolvedValue({
      data: { session: { user } as Session },
      error: null,
    }),
    getUser: vi.fn().mockResolvedValue({
      data: { user },
      error: null,
    }),
    refreshSession: vi.fn().mockResolvedValue({
      data: { session: { user } as Session },
      error: null,
    }),
    onAuthStateChange: vi.fn(() => ({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    })),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }

  return {
    auth,
    client: { auth } as unknown as SupabaseClient,
  }
}

describe('AuthService', () => {
  it('OTP를 요청할 때 신규 사용자 생성을 허용한다', async () => {
    const { auth, client } = createClientMock()
    const service = createAuthService(client)

    await service.requestEmailOtp('walker@example.com')

    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'walker@example.com',
      options: {
        shouldCreateUser: true,
      },
    })
  })

  it('이메일 OTP 유형으로 인증번호를 검증한다', async () => {
    const { auth, client } = createClientMock()
    const service = createAuthService(client)

    const user = await service.verifyEmailOtp(
      'walker@example.com',
      '123456',
    )

    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'walker@example.com',
      token: '123456',
      type: 'email',
    })
    expect(user).toEqual({
      id: 'user-123',
      email: 'walker@example.com',
    })
  })

  it('저장된 세션이 있으면 서버에서 현재 사용자를 확인한다', async () => {
    const { auth, client } = createClientMock()
    const service = createAuthService(client)

    const user = await service.getCurrentUser()

    expect(auth.getSession).toHaveBeenCalledOnce()
    expect(auth.getUser).toHaveBeenCalledOnce()
    expect(user?.id).toBe('user-123')
  })

  it('저장된 세션이 없으면 사용자 서버 요청을 생략한다', async () => {
    const { auth, client } = createClientMock()
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    })
    const service = createAuthService(client)

    const user = await service.getCurrentUser()

    expect(user).toBeNull()
    expect(auth.getUser).not.toHaveBeenCalled()
  })

  it('로그아웃을 Supabase Auth에 요청한다', async () => {
    const { auth, client } = createClientMock()
    const service = createAuthService(client)

    await service.signOut()

    expect(auth.signOut).toHaveBeenCalledOnce()
  })

  it('401 복구 시 SDK가 관리하는 세션을 새로 고친다', async () => {
    const { auth, client } = createClientMock()
    const service = createAuthService(client)

    const user = await service.refreshCurrentUser()

    expect(auth.refreshSession).toHaveBeenCalledOnce()
    expect(user?.id).toBe('user-123')
  })
})
