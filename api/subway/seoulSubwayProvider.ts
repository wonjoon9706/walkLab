import type { SeoulSubwayArrivalRecord } from '../../src/domain/seoulSubway.js'
import {
  parseSeoulSubwayArrivals,
  SeoulSubwayResponseError,
} from './seoulSubwayResponseParser.js'

const SEOUL_SUBWAY_BASE_URL = 'http://swopenAPI.seoul.go.kr/api/subway'

export class SeoulSubwayHttpError extends Error {
  constructor(public readonly status: number) {
    super('서울시 지하철 HTTP 요청이 실패했습니다.')
    this.name = 'SeoulSubwayHttpError'
  }
}

interface SeoulSubwayProviderDependencies {
  fetch: typeof fetch
  serviceKey: string
  allowInsecureHttp: boolean
}

export interface SeoulSubwayProvider {
  getArrivals(
    stationName: string,
    signal: AbortSignal,
  ): Promise<SeoulSubwayArrivalRecord[]>
}

export function createSeoulSubwayProvider(
  dependencies: SeoulSubwayProviderDependencies,
): SeoulSubwayProvider {
  return {
    async getArrivals(stationName, signal) {
      if (!dependencies.allowInsecureHttp) {
        throw new SeoulSubwayResponseError(
          'provider',
          null,
          '서울시 지하철 HTTP 호출이 허용되지 않은 환경입니다.',
        )
      }
      const encodedStationName = encodeURIComponent(stationName)
      const encodedKey = encodeURIComponent(dependencies.serviceKey)
      const response = await dependencies.fetch(
        `${SEOUL_SUBWAY_BASE_URL}/${encodedKey}/json/realtimeStationArrival/0/20/${encodedStationName}`,
        { method: 'GET', signal },
      )
      if (!response.ok) throw new SeoulSubwayHttpError(response.status)
      return parseSeoulSubwayArrivals(await response.text())
    },
  }
}
