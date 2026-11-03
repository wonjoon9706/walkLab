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
  mode: null,
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
  subscribeGps: vi.fn(),
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
    ['/', '길찾기'],
    ['/history', '내 보행 기록'],
    ['/history/summary', '나의 보행 분석'],
    ['/walking-route', '길찾기'],
    ['/transit-route', '길찾기'],
    ['/sessions/test-session', '기록 상세'],
  ])('로그인 사용자는 %s 경로에서 %s 화면을 본다', async (path, heading) => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    renderRoute(path, service)

    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: heading },
        { timeout: 3_000 },
      ),
    ).toBeInTheDocument()
  })

  it('일반 사용자 주요 메뉴는 길찾기와 내 보행 기록 두 개만 표시한다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    renderRoute('/walking-route', service)

    const navigation = await screen.findByRole('navigation', {
      name: '주요 메뉴',
    })
    expect(navigation.querySelectorAll('a, span')).toHaveLength(2)
    expect(navigation).toHaveTextContent('도보 길찾기')
    expect(navigation).toHaveTextContent('내 보행 기록')
    expect(navigation).not.toHaveTextContent('측정 홈')
  })

  it('로그인 사용자는 설정 메뉴와 직접 주소에서 개발자 도구에 접근한다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    renderRoute('/developer-tools', service)

    expect(
      await screen.findByRole('heading', { name: '측정 홈' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '개발자 도구' })).toHaveAttribute(
      'href',
      '/developer-tools',
    )
  })

  it('수동 측정 시작 상태에서는 개발자 도구에서 기존 / 측정 화면으로 안전하게 이동한다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    const startingMeasurement: MeasurementContextValue = {
      ...idleMeasurement,
      status: 'starting',
      mode: 'manual',
      isActive: true,
      sessionId: 'manual-session',
      ownerUserId: testUser.id,
      startedAt: '2026-11-02T00:00:00.000Z',
      gpsStatus: 'waiting',
      stopMeasurement: vi.fn(),
    }

    renderRoute('/developer-tools', service, startingMeasurement)

    expect(
      await screen.findByRole('heading', { name: '측정 홈' }),
    ).toBeInTheDocument()
    expect(startingMeasurement.stopMeasurement).not.toHaveBeenCalled()
  })

  it('비로그인 사용자가 보호 경로를 열면 로그인으로 이동한다', async () => {
    const service = createFakeAuthService()
    renderRoute('/history', service)

    expect(
      await screen.findByRole('heading', { name: '이메일 OTP 로그인' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '내 보행 기록' })).toBeNull()
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
      await screen.findByRole('heading', { name: '길찾기' }),
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
    await screen.findByRole('heading', { name: '길찾기' })

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
      mode: 'manual',
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
      mode: 'manual',
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
      screen.getByText('안내 또는 측정을 종료한 뒤 로그아웃할 수 있습니다.'),
    ).toBeInTheDocument()
  })

  it('상세 경로의 세션 ID를 기본 화면에 노출하지 않는다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    renderRoute('/sessions/test-session', service)

    expect(
      await screen.findByRole('heading', { name: '기록 상세' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('세션 ID: test-session')).toBeNull()
  })

  it('manual 측정 중 walking-route 접근은 기존처럼 측정 홈으로 이동한다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    const activeMeasurement: MeasurementContextValue = {
      ...idleMeasurement,
      status: 'recording',
      mode: 'manual',
      isActive: true,
    }

    renderRoute('/walking-route', service, activeMeasurement)

    expect(
      await screen.findByRole('heading', { name: '측정 홈' }),
    ).toBeInTheDocument()
  })

  it('navigation 측정 중에는 walking-route 화면을 유지한다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    const activeMeasurement: MeasurementContextValue = {
      ...idleMeasurement,
      status: 'starting',
      mode: 'navigation',
      isActive: true,
    }

    renderRoute('/walking-route', service, activeMeasurement)

    expect(
      await screen.findByRole('heading', { name: '길찾기' }),
    ).toBeInTheDocument()
  })

  it('navigation 측정 중 다른 보호 경로는 walking-route로 돌아온다', async () => {
    const service = createFakeAuthService({
      getCurrentUser: vi.fn().mockResolvedValue(testUser),
    })
    const activeMeasurement: MeasurementContextValue = {
      ...idleMeasurement,
      status: 'recording',
      mode: 'navigation',
      isActive: true,
    }

    renderRoute('/history', service, activeMeasurement)

    expect(
      await screen.findByRole('heading', { name: '길찾기' }),
    ).toBeInTheDocument()
  })
})
