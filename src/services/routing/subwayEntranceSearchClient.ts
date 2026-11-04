import type { GeoCoordinate, PlaceSearchResult } from '../../domain/walkingRoute'
import { getSupabaseAccessToken } from './walkingRouteClient'

function isPlace(value: unknown): value is PlaceSearchResult {
  if (typeof value !== 'object' || value === null) return false
  const place = value as Partial<PlaceSearchResult>
  return typeof place.id === 'string' && typeof place.name === 'string' &&
    typeof place.coordinate?.latitude === 'number' &&
    typeof place.coordinate.longitude === 'number'
}

export async function searchSubwayEntrances(
  query: string,
  near: GeoCoordinate,
): Promise<PlaceSearchResult[]> {
  // 현재 REST 검색은 정확한 역·출구 질의를 우선한다. 좌표는 향후 반경 검색에
  // 사용할 입력 계약으로 유지하되 브라우저나 서버 로그로 보내지 않는다.
  void near
  const token = await getSupabaseAccessToken()
  if (token === null) throw new Error('AUTH_SESSION_MISSING')
  const response = await fetch('/api/kakao/subway-entrances', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(body) || !body.every(isPlace)) {
    throw new Error('SUBWAY_ENTRANCE_SEARCH_FAILED')
  }
  return body
}
