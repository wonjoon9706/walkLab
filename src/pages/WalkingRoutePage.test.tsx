import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceSearchResult } from '../domain/walkingRoute'

const {
  getCurrentLocationMock,
  getWalkingRouteMock,
  loadSpeedModelMock,
  navigationStartMock,
  navigationStopMock,
  measurementState,
} = vi.hoisted(() => ({
  getCurrentLocationMock: vi.fn(),
  getWalkingRouteMock: vi.fn(),
  loadSpeedModelMock: vi.fn(),
  navigationStartMock: vi.fn(),
  navigationStopMock: vi.fn(),
  measurementState: { isActive: false },
}))

const manualOrigin: PlaceSearchResult = {
  id: 'origin-1',
  name: '서울역',
  address: '서울 용산구 동자동',
  roadAddress: '서울 용산구 한강대로 405',
  coordinate: { latitude: 37.5547, longitude: 126.9707 },
}

const secondOrigin: PlaceSearchResult = {
  id: 'origin-2',
  name: '시청역',
  address: '서울 중구 정동',
  roadAddress: '서울 중구 세종대로 101',
  coordinate: { latitude: 37.5663, longitude: 126.9779 },
}

const destination: PlaceSearchResult = {
  id: 'destination-1',
  name: '광화문',
  address: '서울 종로구 세종로',
  roadAddress: '서울 종로구 세종대로 172',
  coordinate: { latitude: 37.5759, longitude: 126.9768 },
}

vi.mock('../features/auth/authContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'user@example.com' } }),
}))

vi.mock('../features/measurement/measurementContext', () => ({
  useMeasurement: () => measurementState,
}))

vi.mock('../features/navigation/useLiveNavigation', () => ({
  useLiveNavigation: () => ({
    status: 'idle',
    isActive: false,
    route: null,
    currentPosition: null,
    remainingCoordinates: [],
    remainingDistanceM: null,
    progressRatio: null,
    recentSpeedMps: null,
    appliedSpeedMps: null,
    speedSource: null,
    remainingDurationSeconds: null,
    arrivalAt: null,
    lastPositionAt: null,
    rerouteCount: 0,
    message: null,
    start: navigationStartMock,
    stop: navigationStopMock,
  }),
}))

vi.mock('../services/location/currentLocation', () => ({
  CurrentLocationError: class CurrentLocationError extends Error {},
  getCurrentLocation: getCurrentLocationMock,
}))

vi.mock('../services/learning/currentWalkingSpeedModel', () => ({
  loadCurrentWalkingSpeedModel: loadSpeedModelMock,
}))

vi.mock('../services/routing/walkingRouteClient', () => ({
  walkingRouteClient: { getWalkingRoute: getWalkingRouteMock },
}))

vi.mock('../features/map/WalkingRouteMap', () => ({
  WalkingRouteMap: () => <div>도보 경로 지도</div>,
}))

vi.mock('../features/places/PlaceSearchPanel', () => ({
  PlaceSearchPanel: ({
    idPrefix,
    title,
    onSelect,
    children,
  }: {
    idPrefix: string
    title: string
    onSelect: (place: PlaceSearchResult) => void
    children?: React.ReactNode
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
      {idPrefix === 'origin-place' ? (
        <>
          <button type="button" onClick={() => onSelect(manualOrigin)}>
            서울역 출발 선택
          </button>
          <button type="button" onClick={() => onSelect(secondOrigin)}>
            시청역 출발 선택
          </button>
        </>
      ) : (
        <button type="button" onClick={() => onSelect(destination)}>
          광화문 목적지 선택
        </button>
      )}
    </section>
  ),
}))

beforeEach(() => {
  navigationStartMock.mockReset()
  navigationStopMock.mockReset()
  measurementState.isActive = false
  getCurrentLocationMock.mockRejectedValue(new Error('permission denied'))
  loadSpeedModelMock.mockResolvedValue({
    algorithmVersion: 'recency-weighted-v1',
    status: 'insufficient',
    estimatedSpeedMps: null,
    validSessionCount: 0,
  })
  getWalkingRouteMock.mockResolvedValue({
    distanceM: 1000,
    providerDurationSeconds: 800,
    coordinates: [manualOrigin.coordinate, destination.coordinate],
    provider: 'kakao-walking-route',
    requestedAt: '2026-10-30T00:00:00.000Z',
  })
})

describe('WalkingRoutePage 출발지 선택', () => {
  it('출발지 상태와 검색 기능을 하나의 영역에 표시한다', async () => {
    getCurrentLocationMock.mockResolvedValueOnce({
      latitude: 37.5,
      longitude: 127.1,
    })

    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: '출발지' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '출발지 직접 검색' }),
    ).not.toBeInTheDocument()
    expect(
      await screen.findByText('GPS로 확인한 위치'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '현재 위치로 설정' }),
    ).toBeInTheDocument()
  })

  it('GPS 실패 후에도 검색한 출발지로 경로를 조회한다', async () => {
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))

    await waitFor(() => {
      expect(getWalkingRouteMock).toHaveBeenCalledWith({
        start: manualOrigin.coordinate,
        destination: destination.coordinate,
      })
    })
    expect(
      await screen.findByText(/현재 GPS 위치가 아닌 선택한 출발지/),
    ).toBeInTheDocument()
  })

  it('목적지가 선택된 상태에서 출발지를 바꾸면 다시 조회한다', async () => {
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    await waitFor(() => expect(getWalkingRouteMock).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '시청역 출발 선택' }))

    await waitFor(() => {
      expect(getWalkingRouteMock).toHaveBeenLastCalledWith({
        start: secondOrigin.coordinate,
        destination: destination.coordinate,
      })
    })
  })

  it('조회한 경로와 실제 출발지 조건으로 안내를 시작한다', async () => {
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    await screen.findByRole('button', { name: '안내 시작' })

    fireEvent.click(screen.getByRole('button', { name: '안내 시작' }))

    expect(navigationStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: destination.coordinate,
        forceInitialReroute: true,
      }),
    )
  })

  it('기존 GPS 측정 중에는 실시간 안내를 함께 시작하지 않는다', async () => {
    measurementState.isActive = true
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    fireEvent.click(await screen.findByRole('button', { name: '안내 시작' }))

    expect(navigationStartMock).not.toHaveBeenCalled()
    expect(
      screen.getByText(/GPS 측정 중에는 길찾기 안내를 함께 시작할 수 없습니다/),
    ).toBeInTheDocument()
  })
})

import { WalkingRoutePage } from './WalkingRoutePage'
