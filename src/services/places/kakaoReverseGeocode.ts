import type { GeoCoordinate } from '../../domain/walkingRoute'
import { loadKakaoMapSdk } from '../../features/map/kakaoMapSdk'

export interface ReverseGeocodeResult {
  roadAddress: string | null
  address: string | null
}

export async function reverseGeocodeKakaoCoordinate(
  coordinate: GeoCoordinate,
  javaScriptKey: string | null,
): Promise<ReverseGeocodeResult> {
  if (javaScriptKey === null) {
    throw new Error('KAKAO_MAP_SDK_NOT_CONFIGURED')
  }

  const maps = await loadKakaoMapSdk(javaScriptKey)
  const geocoder = new maps.services.Geocoder()

  return new Promise((resolve, reject) => {
    geocoder.coord2Address(
      coordinate.longitude,
      coordinate.latitude,
      (results, status) => {
        if (status !== maps.services.Status.OK || results.length === 0) {
          reject(new Error('KAKAO_REVERSE_GEOCODE_FAILED'))
          return
        }

        const result = results[0]
        resolve({
          roadAddress: result.road_address?.address_name || null,
          address: result.address?.address_name || null,
        })
      },
    )
  })
}
