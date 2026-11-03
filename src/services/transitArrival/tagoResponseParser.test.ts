import { describe, expect, it } from 'vitest'
import {
  parseTagoArrivals,
  parseTagoCityCodes,
  parseTagoNearbyStops,
  parseTagoRouteStopsPage,
  parseTagoRoutesAtStop,
  TagoResponseError,
} from './tagoResponseParser'

function jsonResponse(items: unknown[], totalCount = items.length): string {
  return JSON.stringify({
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: { items: { item: items }, totalCount },
    },
  })
}

describe('TAGO 응답 파서', () => {
  it('도시코드 JSON 응답을 정규화한다', () => {
    expect(parseTagoCityCodes(jsonResponse([
      { citycode: '22', cityname: '대구광역시' },
    ]))).toEqual([{ code: '22', name: '대구광역시' }])
  })

  it('인근 정류장 XML 응답을 정규화한다', () => {
    const xml = `<?xml version="1.0"?><response><header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header><body><items><item><citycode>25</citycode><gpslati>36.3</gpslati><gpslong>127.3</gpslong><nodeid>DJB1</nodeid><nodenm>성북3통</nodenm></item></items><totalCount>1</totalCount></body></response>`

    expect(parseTagoNearbyStops(xml)).toEqual([{
      cityCode: '25',
      nodeId: 'DJB1',
      name: '성북3통',
      coordinate: { latitude: 36.3, longitude: 127.3 },
      routes: [],
    }])
  })

  it('정류장 경유노선과 도착정보를 공식 필드로 파싱한다', () => {
    expect(parseTagoRoutesAtStop(jsonResponse([
      { routeid: 'DJB30300002', routeno: '5', routetp: '마을버스' },
    ]))).toEqual([{
      routeId: 'DJB30300002',
      routeName: '5',
      nextStopCoordinate: null,
    }])

    expect(parseTagoArrivals(jsonResponse([{
      nodeid: 'DJB8001793',
      nodenm: '북대전농협',
      routeid: 'DJB30300002',
      routeno: '5',
      routetp: '마을버스',
      arrprevstationcnt: 15,
      arrtime: 816,
    }]))).toEqual([{
      nodeId: 'DJB8001793',
      nodeName: '북대전농협',
      routeId: 'DJB30300002',
      routeName: '5',
      routeType: '마을버스',
      remainingStops: 15,
      arrivalSeconds: 816,
    }])
  })

  it('노선별 경유 정류장의 순서·좌표·updowncd를 그대로 보존한다', () => {
    expect(parseTagoRouteStopsPage(jsonResponse([{
      routeid: 'DJB30300002',
      nodeid: 'DJB8001793',
      nodenm: '북대전농협',
      nodeord: 7,
      gpslati: 36.3,
      gpslong: 127.3,
      updowncd: '0',
    }]))).toEqual({
      totalCount: 1,
      stops: [{
        routeId: 'DJB30300002',
        nodeId: 'DJB8001793',
        name: '북대전농협',
        sequence: 7,
        coordinate: { latitude: 36.3, longitude: 127.3 },
        upDownCode: '0',
      }],
    })
  })

  it('totalCount 0 응답은 빈 목록으로 처리한다', () => {
    expect(parseTagoArrivals(jsonResponse([], 0))).toEqual([])
  })

  it('노선 경유 정류장 항목 하나라도 필수 값이 없으면 전체를 거부한다', () => {
    expect(() => parseTagoRouteStopsPage(jsonResponse([{
      routeid: 'ROUTE-1', nodeid: 'STOP-1', nodenm: '승차정류장', nodeord: 1,
    }, {
      routeid: 'ROUTE-1', nodeid: 'STOP-2', nodeord: 2,
    }]))).toThrow(TagoResponseError)
  })

  it('JSON 요청에도 반환될 수 있는 XML 인증 오류를 구분한다', () => {
    const xml = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`

    expect(() => parseTagoCityCodes(xml)).toThrowError(
      expect.objectContaining<Partial<TagoResponseError>>({
        kind: 'provider',
        providerCode: '30',
      }),
    )
  })

  it('깨진 JSON과 필수 필드 누락을 형식 오류로 처리한다', () => {
    expect(() => parseTagoCityCodes('{broken')).toThrow(TagoResponseError)
    expect(() => parseTagoNearbyStops(jsonResponse([{ nodeid: 'A' }]))).toThrow(
      '필수 값이 올바르지 않습니다',
    )
  })
})
