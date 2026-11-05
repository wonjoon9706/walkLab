import { describe, expect, it } from 'vitest'
import {
  parseSeoulNearbyStops,
  parseSeoulRouteArrivals,
  parseSeoulRoutesAtStop,
  SeoulBusResponseError,
} from './seoulBusResponseParser.js'

function response(itemList: unknown, itemCount = 0): string {
  return JSON.stringify({
    msgHeader: {
      headerCd: '0',
      headerMsg: '정상 처리되었습니다.',
      itemCount,
    },
    msgBody: { itemList },
  })
}

describe('서울시 버스 JSON 응답 파서', () => {
  it('itemCount가 0이어도 실제 인근 정류장 배열을 사용한다', () => {
    expect(parseSeoulNearbyStops(response([{
      stId: '103000189',
      arsId: '04293',
      stNm: '우리은행화양동지점',
      tmX: '127.066142',
      tmY: '37.548142',
    }]))).toEqual([{
      stopId: '103000189',
      arsId: '04293',
      name: '우리은행화양동지점',
      coordinate: { latitude: 37.548142, longitude: 127.066142 },
    }])
  })

  it('정류장 경유 노선에서 2222 노선 ID를 보존한다', () => {
    expect(parseSeoulRoutesAtStop(response({
      busRouteId: '100100199',
      busRouteNm: '2222',
      busRouteType: '3',
    }))).toEqual([{
      routeId: '100100199',
      routeName: '2222',
      routeType: '3',
    }])
  })

  it('노선 전체 응답에서 첫 번째와 두 번째 도착정보를 분리한다', () => {
    expect(parseSeoulRouteArrivals(response([{
      busRouteId: '100100199',
      rtNm: '2222',
      routeType: '3',
      stId: '103000189',
      arsId: '04293',
      stNm: '우리은행화양동지점',
      staOrd: '20',
      arrmsgSec1: '180',
      arrmsgSec2: '540',
      arrmsg1: '3분 후',
      arrmsg2: '9분 후',
      sectOrd1: '17',
      sectOrd2: '12',
    }]))[0]).toMatchObject({
      routeId: '100100199',
      stopId: '103000189',
      sequence: 20,
      estimates: [
        { order: 1, arrivalSeconds: 180, remainingStops: 3 },
        { order: 2, arrivalSeconds: 540, remainingStops: 8 },
      ],
    })
  })

  it('실측 응답처럼 arrmsgSec이 비어 있으면 초 단위 traTime을 그대로 사용한다', () => {
    expect(parseSeoulRouteArrivals(response([{
      busRouteId: '100100052',
      rtNm: '302',
      routeType: '3',
      stId: '103000000',
      arsId: '00000',
      stNm: '성동세무서',
      staOrd: '54',
      arrmsgSec1: '',
      arrmsgSec2: '',
      traTime1: '540',
      traTime2: '813',
      arrmsg1: '9분0초후[0번째 전]',
      arrmsg2: '13분33초후[6번째 전]',
      sectOrd1: '54',
      sectOrd2: '48',
    }]))[0].estimates).toEqual([
      {
        order: 1,
        arrivalSeconds: 540,
        remainingStops: 0,
        message: '9분0초후[0번째 전]',
        serviceStatus: 'in_service',
        rawStopSequence: 54,
        rawSectionSequence: 54,
        arrivalTimeStatus: 'estimated',
      },
      {
        order: 2,
        arrivalSeconds: 813,
        remainingStops: 6,
        message: '13분33초후[6번째 전]',
        serviceStatus: 'in_service',
        rawStopSequence: 54,
        rawSectionSequence: 48,
        arrivalTimeStatus: 'estimated',
      },
    ])
  })

  it('0초인데 정류장이 남은 출발대기 값은 누락과 구분해 확인 필요로 보존한다', () => {
    const estimates = parseSeoulRouteArrivals(response([{
      busRouteId: '119900016',
      rtNm: '동작17',
      stId: '119900260',
      stNm: '극동아파트112동',
      staOrd: '3',
      traTime1: '0',
      traTime2: '0',
      sectOrd1: '0',
      sectOrd2: '0',
      arrmsg1: '출발대기',
      arrmsg2: '출발대기',
    }]))[0].estimates

    expect(estimates).toEqual([
      {
        order: 1, arrivalSeconds: 0, remainingStops: null,
        message: '출발대기', serviceStatus: 'departure_waiting',
        rawStopSequence: 3, rawSectionSequence: 0,
        arrivalTimeStatus: 'review_required',
      },
      {
        order: 2, arrivalSeconds: 0, remainingStops: null,
        message: '출발대기', serviceStatus: 'departure_waiting',
        rawStopSequence: 3, rawSectionSequence: 0,
        arrivalTimeStatus: 'review_required',
      },
    ])
  })

  it('시간 필드 누락은 estimate를 만들지 않고 실제 0초·0정거장은 유지한다', () => {
    const missing = parseSeoulRouteArrivals(response([{
      busRouteId: 'route', rtNm: '테스트', stId: 'stop-a',
      stNm: '테스트정류장', staOrd: '3',
    }]))[0]
    const zeroAtStop = parseSeoulRouteArrivals(response([{
      busRouteId: 'route', rtNm: '테스트', stId: 'stop-b',
      stNm: '테스트정류장', staOrd: '3',
      arrmsgSec1: '0', sectOrd1: '3', arrmsg1: '도착',
    }]))[0]

    expect(missing.estimates).toEqual([])
    expect(zeroAtStop.estimates[0]).toMatchObject({
      arrivalSeconds: 0,
      remainingStops: 0,
      arrivalTimeStatus: 'estimated',
    })
  })

  it('0초·0정거장이어도 원본 안내가 출발대기면 즉시 도착으로 보지 않는다', () => {
    const estimate = parseSeoulRouteArrivals(response([{
      busRouteId: 'route', rtNm: '테스트', stId: 'stop',
      stNm: '테스트정류장', staOrd: '3',
      traTime1: '0', sectOrd1: '3', arrmsg1: '출발 대기',
    }]))[0].estimates[0]

    expect(estimate).toMatchObject({
      arrivalSeconds: 0,
      remainingStops: null,
      serviceStatus: 'departure_waiting',
      rawStopSequence: 3,
      rawSectionSequence: 3,
      arrivalTimeStatus: 'review_required',
    })
  })

  it('서울시 오류 헤더와 깨진 필수 필드를 정상 빈 결과로 처리하지 않는다', () => {
    expect(() => parseSeoulNearbyStops(JSON.stringify({
      msgHeader: { headerCd: '4', headerMsg: '인증키 오류' },
      msgBody: { itemList: [] },
    }))).toThrow(SeoulBusResponseError)
    expect(() => parseSeoulNearbyStops(response([{
      stId: '103000189', arsId: '04293',
    }]))).toThrow(SeoulBusResponseError)
  })
})
