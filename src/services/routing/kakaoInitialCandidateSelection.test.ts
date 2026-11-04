import { describe, expect, it } from 'vitest'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import { selectInitialKakaoPersonalizationRoutes } from './kakaoInitialCandidateSelection'

function route(
  id: string,
  duration: number,
  mode: 'BUS' | 'SUBWAY',
  boardingName: string,
  vehicleName: string,
): KakaoTransitRoute {
  return {
    id,
    type: mode,
    totalDistanceM: 1_000,
    totalDurationSeconds: duration,
    transferCount: 0,
    fare: null,
    steps: [{
      index: 0,
      mode,
      guidance: boardingName,
      distanceM: 1_000,
      durationSeconds: duration,
      stops: [{ index: 0, name: boardingName }],
      vehicles: [{ index: 0, name: vehicleName, type: null }],
      coordinates: [],
    }],
  }
}

describe('초기 카카오 개인화 후보 선정', () => {
  it('기본시간이 빠른 순서를 우선하면서 접근 역과 버스 연계를 다양화한다', () => {
    const routes = [
      route('isu-fast', 1_000, 'SUBWAY', '이수', '7호선'),
      route('isu-similar', 1_010, 'SUBWAY', '이수', '7호선'),
      route('bus', 1_050, 'BUS', '극동아파트112동', '동작17'),
      route('namseong', 1_100, 'SUBWAY', '남성', '7호선'),
      route('slow', 1_500, 'BUS', '다른 정류장', '3217'),
    ]

    expect(selectInitialKakaoPersonalizationRoutes(routes).map((item) => item.id))
      .toEqual(['isu-fast', 'bus', 'namseong'])
  })

  it('접근 방식 종류가 부족하면 남은 후보를 기본시간 순으로 채운다', () => {
    const routes = [
      route('first', 1_000, 'SUBWAY', '이수', '7호선'),
      route('second', 1_100, 'SUBWAY', '이수', '7호선'),
      route('third', 1_200, 'SUBWAY', '이수', '7호선'),
    ]

    expect(selectInitialKakaoPersonalizationRoutes(routes).map((item) => item.id))
      .toEqual(['first', 'second', 'third'])
  })
})
