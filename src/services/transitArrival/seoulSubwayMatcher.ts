import type { SubwayTrainType } from '../../domain/subwayArrival.js'

const SEOUL_SUBWAY_ID_BY_LINE_NAME: Readonly<Record<string, string>> = {
  '1호선': '1001',
  '2호선': '1002',
  '3호선': '1003',
  '4호선': '1004',
  '5호선': '1005',
  '6호선': '1006',
  '7호선': '1007',
  '8호선': '1008',
  '9호선': '1009',
}


const SEOUL_SUBWAY_QUERY_ALIASES: Readonly<Record<string, string>> = {
  이수: '총신대입구(이수)',
  // 서울시 API 실측 역명은 병기명을 포함해야 하며 짧은 이름은 INFO-200을 반환한다.
  어린이대공원: '어린이대공원(세종대)',
}

const SEOUL_SUBWAY_STATION_NAME_ALIASES: Readonly<Record<string, string>> = {
  // 서울시 API와 경로 공급자의 환승역 표기 차이를 명시적 별칭으로만 연결한다.
  총신대입구: '이수',
}

export function getSeoulSubwayIdByLineName(lineName: string): string | null {
  const normalized = lineName.normalize('NFKC').replace(/\s+/g, '')
  return SEOUL_SUBWAY_ID_BY_LINE_NAME[normalized] ?? null
}

export function normalizeSubwayStationName(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/\([^)]*\)/g, '')
    .replace(/역$/u, '')
    .replace(/[\s.·ㆍ]/g, '')
    .toLowerCase()
  return SEOUL_SUBWAY_STATION_NAME_ALIASES[normalized] ?? normalized
}

export function getSeoulSubwayQueryName(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/역$/u, '')
  return SEOUL_SUBWAY_QUERY_ALIASES[normalized] ?? normalized
}

export function isSameSubwayStationName(
  left: string,
  right: string,
): boolean {
  return normalizeSubwayStationName(left) === normalizeSubwayStationName(right)
}

export function readDirectionStationName(trainLineName: string): string | null {
  const match = trainLineName.match(/[-–—]\s*(.+?)\s*방면/u)
  return match === null ? null : match[1].trim()
}

export function readDestinationName(trainLineName: string): string {
  const directionSeparator = trainLineName.search(/[-–—]/u)
  const destinationPart = directionSeparator < 0
    ? trainLineName
    : trainLineName.slice(0, directionSeparator)
  return destinationPart.trim().replace(/(?:행|종착)$/u, '').trim()
}

export function normalizeSeoulTrainType(value: string): SubwayTrainType | null {
  const normalized = value.normalize('NFKC').trim()
  if (normalized.includes('급행') || normalized.includes('특급')) {
    return 'express'
  }
  if (normalized === '' || normalized.includes('일반')) return 'normal'
  return null
}
