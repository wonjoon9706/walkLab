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
import { MeasurementContext } from '../features/measurement/measurementContext'
import type { MeasurementContextValue } from '../features/measurement/measurementContext'
import { SyncContext, type SyncContextValue } from '../features/sync/syncContext'

const idleSync: SyncContextValue = {
  status: 'idle',
  pendingCount: 0,
  confirmedCount: 0,
  failedCount: 0,
  lastSyncedAt: null,
  message: null,
  runSync: vi.fn(),
  notifyPointSaved: vi.fn(),
  notifyMeasurementStopped: vi.fn(),
}

const idleMeasurement: MeasurementContextValue = {
  status: 'idle',
  sessionId: null,
  ownerUserId: null,
  startedAt: null,
  endedAt: null,
  savedPointCount: 0,
  failedSaveCount: 0,
  firstSavedSequenceNo: null,
  lastSavedSequenceNo: null,
  nullOptionalFieldCount: 0,
  lastReceivedAt: null,
  gpsStatus: 'idle',
  localSaveStatus: 'idle',
  networkOnline: true,
  message: null,
  isActive: false,
  startMeasurement: vi.fn(),
  stopMeasurement: vi.fn(),
}

function renderRoute(
  path: string,
  service: AuthService,
  measurement: MeasurementContextValue = idleMeasurement,
) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider service={service}>
        <SyncContext.Provider value={idleSync}>
          <MeasurementContext.Provider value={measurement}>
            <AppRoutes />
          </MeasurementContext.Provider>
        </SyncContext.Provider>
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

  it('측정 중 인증이 만료되면 측정 홈을 유지한다', async () => {
    let authChangeListener: ((change: AuthChange) => void) | null = null
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
      subscribeToAuthChanges: vi.fn((listener) => {
        authChangeListener = listener
        return () => undefined
      }),
    })
    const activeMeasurement: MeasurementContextValue = {
      ...idleMeasurement,
      status: 'recording',
      isActive: true,
      sessionId: 'session-1',
      ownerUserId: testUser.id,
      startedAt: '2026-10-29T00:00:00.000Z',
      gpsStatus: 'receiving',
    }
    renderRoute('/', service, activeMeasurement)
    await screen.findByRole('heading', { name: '측정 홈' })

    act(() => {
      authChangeListener?.({ event: 'SIGNED_OUT', user: null })
    })

    expect(
      await screen.findByText(/로그인 세션이 만료됐지만 GPS와 로컬 저장은 계속됩니다/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '이메일 OTP 로그인' }),
    ).toBeNull()
  })

  it('측정 중 로그아웃 요청은 종료 안내만 표시한다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    const activeMeasurement: MeasurementContextValue = {
      ...idleMeasurement,
      status: 'recording',
      isActive: true,
      sessionId: 'session-1',
      ownerUserId: testUser.id,
      startedAt: '2026-10-29T00:00:00.000Z',
      gpsStatus: 'receiving',
    }
    renderRoute('/', service, activeMeasurement)

    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }))

    expect(service.signOut).not.toHaveBeenCalled()
    expect(
      screen.getByText('측정 종료 버튼을 누른 뒤 로그아웃해 주세요.'),
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
