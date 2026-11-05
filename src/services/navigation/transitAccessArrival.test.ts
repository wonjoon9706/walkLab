import { describe, expect, it } from 'vitest'
import { createTransitAccessArrivalDetector, resolveTransitRecordingTarget } from './transitAccessArrival'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import { buildTransitAccessWalk } from '../routing/transitAccessWalk'

const target = { latitude: 37, longitude: 127 }
const started = Date.parse('2026-11-05T00:00:00Z')
function fix(seconds: number, offsetM = 0, accuracy = 5): GeolocationPosition {
  return { timestamp: started + seconds * 1_000, coords: {
    latitude: 37 + offsetM / 111_000, longitude: 127, accuracy,
    altitude: null, altitudeAccuracy: null, heading: null, speed: null,
  } } as GeolocationPosition
}

describe('첫 탑승 지점 도착 판정', () => {
  it('지하철 중심 경로 좌표 대신 검증된 실제 출입구 좌표를 사용한다', () => {
    const route: KakaoTransitRoute = {
      id: 'route', type: 'SUBWAY', totalDistanceM: 1_000, totalDurationSeconds: 900,
      transferCount: 0, fare: null, steps: [{
        index: 0, mode: 'SUBWAY', guidance: '테스트역', distanceM: 900, durationSeconds: 600,
        stops: [{ index: 0, name: '테스트역' }, { index: 1, name: '다음역' }],
        vehicles: [{ index: 0, name: '7호선', type: null }],
        coordinates: [{ latitude: 37.005, longitude: 127 }, { latitude: 37.01, longitude: 127 }],
      }],
    }
    expect(resolveTransitRecordingTarget(route, null)).toBeNull()
    const built = buildTransitAccessWalk({
      route, origin: { coordinate: { latitude: 37.001, longitude: 127 }, verification: 'searched_place', note: null },
      target: {
        mode: 'SUBWAY', boardingPointName: '테스트역', routeName: '7호선', locationName: '테스트역 7호선 1번출구',
        coordinate: target, source: 'kakao_place_subway_entrance', providerPlaceId: 'synthetic-exit',
        verification: 'explicit_subway_entrance', categoryName: '지하철역출구', closureStatus: 'unknown',
        lineAccessStatus: 'unverified', selectionBasis: 'shortest_valid_external_walk', selectionConfidence: 'provisional',
        internalStationTimeIncluded: false,
      },
      walkingRoute: { distanceM: 110, providerDurationSeconds: 100, provider: 'kakao-walking-route',
        requestedAt: new Date(started).toISOString(), coordinates: [{ latitude: 37.001, longitude: 127 }, target] },
      speed: { kind: 'g7_model', model: null },
    })
    if (built.status !== 'ready') throw new Error('fixture')
    const access = { status: 'ready' as const, accessWalk: built.accessWalk, busCandidates: [], subwayCandidates: [], busDiagnostics: null }
    expect(resolveTransitRecordingTarget(route, access)).toMatchObject({ coordinate: target, source: 'kakao_place_subway_entrance' })
    const multi = { ...route, steps: [{ ...route.steps[0], vehicles: [...route.steps[0].vehicles, { index: 1, name: '다른 노선', type: null }] }] }
    expect(resolveTransitRecordingTarget(multi, access)).toBeNull()
    expect(resolveTransitRecordingTarget({ ...route, id: 'another-route' }, access)).toBeNull()
  })
  it('40m 밖에서는 종료하지 않고 30m 이내 정확도의 연속 세 위치에서만 도착한다', () => {
    const detector = createTransitAccessArrivalDetector(target, started)
    expect(detector.observe(fix(1, 45), started + 1_000).arrived).toBe(false)
    expect(detector.observe(fix(2, 35, 30), started + 2_000).arrived).toBe(false)
    expect(detector.observe(fix(3, 34), started + 3_000).arrived).toBe(false)
    expect(detector.observe(fix(4, 33), started + 4_000).arrived).toBe(true)
    expect(detector.observe(fix(5, 32), started + 5_000).arrived).toBe(false)
  })

  it('정확도 부족·중복·오래된 위치로 연속 횟수를 채우지 않는다', () => {
    const detector = createTransitAccessArrivalDetector(target, started)
    detector.observe(fix(1), started + 1_000)
    expect(detector.observe(fix(1), started + 2_000).arrived).toBe(false)
    detector.observe(fix(2, 0, 31), started + 2_000)
    expect(detector.observe(fix(3), started + 3_000).arrived).toBe(false)
    expect(detector.observe(fix(4), started + 30_000).arrived).toBe(false)
    expect(detector.observe(fix(31), started + 31_000).arrived).toBe(false)
  })

  it('위치 도약과 수신 간격 단절 뒤에는 다시 연속 위치를 확인한다', () => {
    const detector = createTransitAccessArrivalDetector(target, started)
    detector.observe(fix(1, 500), started + 1_000)
    expect(detector.observe(fix(2), started + 2_000).arrived).toBe(false)
    expect(detector.observe(fix(3), started + 3_000).arrived).toBe(false)
    expect(detector.observe(fix(4), started + 4_000).arrived).toBe(false)
    expect(detector.observe(fix(30), started + 30_000).arrived).toBe(false)
    expect(detector.observe(fix(31), started + 31_000).arrived).toBe(false)
    expect(detector.observe(fix(32), started + 32_000).arrived).toBe(true)
  })

  it('좌표 미확정이면 거리나 도착 여부를 생성하지 않는다', () => {
    const detector = createTransitAccessArrivalDetector(null, started)
    for (const second of [1, 2, 3, 4]) {
      expect(detector.observe(fix(second), started + second * 1_000)).toMatchObject({ arrived: false, distanceM: null })
    }
  })
})
