import { describe, expect, it } from 'vitest'
import {
  getSeoulSubwayId,
  getSeoulSubwayQueryName,
  getTmapSubwayTrainType,
  isSameSubwayStationName,
  readDirectionStationName,
} from './seoulSubwayMatcher'

describe('서울시 지하철 식별 규칙', () => {
  it('TMAP 노선 유형을 서울시 노선 ID로 변환한다', () => {
    expect(getSeoulSubwayId(2)).toBe('1002')
    expect(getSeoulSubwayId(7)).toBe('1007')
    expect(getSeoulSubwayId(10)).toBe('1002')
    expect(getSeoulSubwayId(125)).toBe('1032')
    expect(getSeoulSubwayId(112)).toBeNull()
    expect(getTmapSubwayTrainType(119, '4호선')).toBe('express')
  })

  it('확실한 역명 차이와 다음 역 방향을 보수적으로 판별한다', () => {
    expect(isSameSubwayStationName('건대입구', '건대입구역')).toBe(true)
    expect(isSameSubwayStationName('총신대입구(이수)', '이수역')).toBe(true)
    expect(isSameSubwayStationName(
      '숭실대입구(살피재)',
      '이수역',
    )).toBe(false)
    expect(isSameSubwayStationName('총신대입구', '숭실대입구')).toBe(false)
    expect(isSameSubwayStationName('서울', '서울역 KTX')).toBe(false)
    expect(readDirectionStationName('성수행 - 구의방면')).toBe('구의')
    expect(readDirectionStationName(
      '도봉산행 - 총신대입구(이수)방면',
    )).toBe('총신대입구(이수)')
    expect(getSeoulSubwayQueryName('어린이대공원역')).toBe(
      '어린이대공원(세종대)',
    )
  })
})
