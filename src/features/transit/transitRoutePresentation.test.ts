import { describe, expect, it } from 'vitest'
import type { TransitMode, TransitRouteLeg } from '../../domain/transitRoute'
import {
  getTransitRouteLabel,
  normalizeTmapRouteColor,
} from './transitRoutePresentation'

function createLeg(
  mode: TransitMode,
  routeType: number | null,
  routeName: string | null,
): TransitRouteLeg {
  return {
    mode,
    routeType,
    routeName,
    routeColor: null,
    distanceM: 1000,
    durationSeconds: 600,
    startName: '지하철역 앞 버스정류장',
    endName: '도착 정류장',
    coordinates: [],
  }
}

describe('TMAP 노선 표시', () => {
  it.each([
    [1, '일반'], [2, '좌석'], [3, '마을'], [4, '직행좌석'],
    [5, '공항'], [6, '간선급행'], [10, '외곽'], [11, '간선'],
    [12, '지선'], [13, '순환'], [14, '광역'], [15, '급행'],
    [16, '시외'], [17, '리무진'], [21, '농어촌'],
    [22, '시외버스'], [23, '고속버스'],
  ])('공식 버스 type %i를 %s 유형으로 표시한다', (type, label) => {
    expect(getTransitRouteLabel(createLeg('BUS', type, '100')))
      .toBe(`버스 · ${label} 100`)
  })

  it('공식 유형 접두사가 포함된 버스 노선명을 중복 표시하지 않는다', () => {
    expect(getTransitRouteLabel(createLeg('BUS', 12, '지선:2222')))
      .toBe('버스 · 지선 2222')
  })

  it.each([
    [1, '1호선'], [2, '2호선'], [100, '수인분당선'],
    [109, '신분당선'], [125, 'GTX-A'],
  ])('공식 지하철 type %i를 %s 노선으로 표시한다', (type, label) => {
    expect(getTransitRouteLabel(createLeg('SUBWAY', type, '긴 지역 노선명')))
      .toBe(`지하철 · ${label}`)
  })

  it.each([
    [1, 'KTX'], [11, 'SRT'], [12, '무궁화'], [15, 'ITX새마을'],
  ])('공식 기차 type %i를 %s 열차로 표시한다', (type, label) => {
    expect(getTransitRouteLabel(createLeg('TRAIN', type, null)))
      .toBe(`기차 · ${label}`)
  })

  it('정류장 이름에 지하철이 있어도 BUS mode를 지하철로 추측하지 않는다', () => {
    expect(getTransitRouteLabel(createLeg('BUS', null, '마을버스10')))
      .toBe('버스 · 마을버스10')
  })

  it('알 수 없는 유형 코드는 응답 노선명만 안전하게 표시한다', () => {
    expect(getTransitRouteLabel(createLeg('BUS', 999, '지역노선 A')))
      .toBe('버스 · 지역노선 A')
  })

  it('고속·시외버스 mode는 BUS 유형 코드로 추측하지 않는다', () => {
    expect(getTransitRouteLabel(createLeg('EXPRESSBUS', 23, '서울-부산')))
      .toBe('고속·시외버스 · 서울-부산')
  })

  it('유효한 TMAP 색상만 CSS 색상으로 정규화한다', () => {
    expect(normalizeTmapRouteColor('0068B7')).toBe('#0068B7')
    expect(normalizeTmapRouteColor('#00A84D')).toBe('#00A84D')
    expect(normalizeTmapRouteColor(null)).toBeNull()
    expect(normalizeTmapRouteColor('not-a-color')).toBeNull()
  })
})
