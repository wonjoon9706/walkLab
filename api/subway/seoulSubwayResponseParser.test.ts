import { describe, expect, it } from 'vitest'
import {
  parseSeoulSubwayArrivals,
  SeoulSubwayResponseError,
} from './seoulSubwayResponseParser'

function response(items: unknown[]): string {
  return JSON.stringify({
    errorMessage: { code: 'INFO-000', message: '정상 처리되었습니다.' },
    realtimeArrivalList: items,
  })
}

describe('서울시 지하철 실시간 도착정보 파서', () => {
  it('건대입구의 노선 ID와 초 단위 도착시간을 보존한다', () => {
    const result = parseSeoulSubwayArrivals(response([
      {
        subwayId: '1002', statnNm: '건대입구', updnLine: '내선',
        trainLineNm: '성수행 - 구의방면', btrainSttus: '일반',
        barvlDt: '110', recptnDt: '2026-11-03 12:00:00',
        arvlCd: '99', arvlMsg2: '2분 후',
      },
      {
        subwayId: '1007', statnNm: '건대입구', updnLine: '상행',
        trainLineNm: '장암행 - 어린이대공원방면', btrainSttus: '일반',
        barvlDt: '250', recptnDt: '2026-11-03 12:00:00',
        arvlCd: '99', arvlMsg2: '4분 후',
      },
    ]))

    expect(result.map((item) => item.subwayId)).toEqual(['1002', '1007'])
    expect(result[0]).toMatchObject({
      arrivalSeconds: 110,
      generatedAt: '2026-11-03T03:00:00.000Z',
    })
  })

  it('데이터 없음과 오류·깨진 응답을 구분한다', () => {
    expect(parseSeoulSubwayArrivals(JSON.stringify({
      errorMessage: { code: 'INFO-200', message: '해당하는 데이터가 없습니다.' },
    }))).toEqual([])
    expect(() => parseSeoulSubwayArrivals(JSON.stringify({
      errorMessage: { code: 'ERROR-300', message: '인증키가 유효하지 않습니다.' },
    }))).toThrow(SeoulSubwayResponseError)
    expect(() => parseSeoulSubwayArrivals(response([{
      subwayId: '1002', statnNm: '건대입구',
    }]))).toThrow(SeoulSubwayResponseError)
  })

  it('실측된 최상위 INFO-200 데이터 없음 응답을 빈 목록으로 처리한다', () => {
    expect(parseSeoulSubwayArrivals(JSON.stringify({
      status: 500,
      code: 'INFO-200',
      message: '해당하는 데이터가 없습니다.',
      total: 0,
    }))).toEqual([])
  })

  it('최상위 인증 오류 객체는 데이터 없음과 구분한다', () => {
    expect(() => parseSeoulSubwayArrivals(JSON.stringify({
      status: 500,
      code: 'ERROR-300',
      message: '인증키가 유효하지 않습니다.',
    }))).toThrowError(expect.objectContaining({
      kind: 'provider',
      providerCode: 'ERROR-300',
    }))
  })
})
