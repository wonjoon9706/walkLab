import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../features/auth/AuthProvider'
import type {
  AuthChange,
  AuthService,
} from '../services/auth/authService'
import {
  createFakeAuthService,
  testUser,
} from '../test/fakeAuthService'
import { AppRoutes } from './router'

function renderRoute(path: string, service: AuthService) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider service={service}>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('인증 라우팅', () => {
  it.each([
    ['/', '측정 홈'],
    ['/history', '기록 목록'],
    ['/sessions/test-session', '기록 상세'],
  ])('로그인 사용자는 %s 경로에서 %s 화면을 본다', async (path, heading) => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    renderRoute(path, service)

    expect(
      await screen.findByRole('heading', { level: 1, name: heading }),
    ).toBeInTheDocument()
  })

  it('비로그인 사용자가 보호 경로를 열면 로그인으로 이동한다', async () => {
    const service = createFakeAuthService()
    renderRoute('/history', service)

    expect(
      await screen.findByRole('heading', { name: '이메일 OTP 로그인' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '기록 목록' })).toBeNull()
  })

  it('로그인 상태 확인 중에는 보호 화면을 먼저 표시하지 않는다', () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn(() => new Promise<null>(() => undefined)),
      subscribeToAuthChanges: vi.fn((listener) => {
        listener({
          event: 'INITIAL_SESSION',
          user: testUser,
        })
        return () => undefined
      }),
    })
    renderRoute('/', service)

    expect(
      screen.getByRole('heading', { name: '로그인 상태 확인 중' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '측정 홈' })).toBeNull()
  })

  it('로그인 사용자가 로그인 경로를 열면 홈으로 이동한다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    renderRoute('/login', service)

    expect(
      await screen.findByRole('heading', { name: '측정 홈' }),
    ).toBeInTheDocument()
  })

  it('로그아웃 후 로그인 화면으로 이동한다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    renderRoute('/', service)

    fireEvent.click(
      await screen.findByRole('button', { name: '로그아웃' }),
    )

    await waitFor(() => {
      expect(service.signOut).toHaveBeenCalledOnce()
    })
    expect(
      await screen.findByRole('heading', { name: '이메일 OTP 로그인' }),
    ).toBeInTheDocument()
  })

  it('인증 세션이 만료되면 로그인 화면으로 이동한다', async () => {
    let authChangeListener: ((change: AuthChange) => void) | null = null
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
      subscribeToAuthChanges: vi.fn((listener) => {
        authChangeListener = listener
        return () => undefined
      }),
    })
    renderRoute('/', service)
    await screen.findByRole('heading', { name: '측정 홈' })

    act(() => {
      authChangeListener?.({
        event: 'SIGNED_OUT',
        user: null,
      })
    })

    expect(
      await screen.findByRole('heading', { name: '이메일 OTP 로그인' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'),
    ).toBeInTheDocument()
  })

  it('상세 경로의 세션 ID를 표시한다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    renderRoute('/sessions/test-session', service)

    expect(
      await screen.findByText('세션 ID: test-session'),
    ).toBeInTheDocument()
  })
})
