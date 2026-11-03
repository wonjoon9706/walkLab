import type {
  TransitMode,
  TransitRouteLeg,
} from '../../domain/transitRoute'

const BUS_TYPE_LABELS: Readonly<Record<number, string>> = {
  1: '일반',
  2: '좌석',
  3: '마을',
  4: '직행좌석',
  5: '공항',
  6: '간선급행',
  10: '외곽',
  11: '간선',
  12: '지선',
  13: '순환',
  14: '광역',
  15: '급행',
  16: '시외',
  17: '리무진',
  21: '농어촌',
  22: '시외버스',
  23: '고속버스',
}

const SUBWAY_TYPE_LABELS: Readonly<Record<number, string>> = {
  1: '1호선', 2: '2호선', 3: '3호선', 4: '4호선', 5: '5호선',
  6: '5호선', 7: '7호선', 8: '8호선', 9: '9호선',
  10: '2호선(성수지선)', 11: '2호선(신정지선)',
  21: '인천1호선', 22: '인천2호선', 31: '대전1호선',
  41: '대구1호선', 42: '대구2호선', 43: '대구3호선',
  44: '대경선', 51: '광주1호선', 71: '부산1호선',
  72: '부산2호선', 73: '부산3호선', 74: '부산4호선',
  78: '동해선', 79: '부산김해경전철', 100: '수인분당선',
  101: '공항철도', 104: '경의중앙선', 107: '용인에버라인',
  108: '경춘선', 109: '신분당선', 110: '의정부경전철',
  112: '경강선', 113: '우이신설선', 114: '서해선',
  115: '김포골드라인', 116: '신림선', 117: '1호선(급행)',
  118: '1호선(특급)', 119: '4호선(급행)', 120: '9호선(급행)',
  121: '수인분당선(급행)', 122: '경의중앙선(급행)',
  123: '경춘선(급행)', 124: '공항철도(급행)', 125: 'GTX-A',
}

const TRAIN_TYPE_LABELS: Readonly<Record<number, string>> = {
  1: 'KTX', 2: 'KTX산천', 3: 'KTX이음', 4: 'KTX청룡',
  11: 'SRT', 12: '무궁화', 13: '새마을', 14: '누리로',
  15: 'ITX새마을', 16: 'ITX청춘', 17: 'ITX마음', 31: '통근열차',
}

const MODE_LABELS: Readonly<Record<TransitMode, string>> = {
  WALK: '도보',
  BUS: '버스',
  SUBWAY: '지하철',
  EXPRESSBUS: '고속·시외버스',
  TRAIN: '기차',
  AIRPLANE: '항공',
  FERRY: '해운',
}

function removeMatchingBusPrefix(routeName: string, typeLabel: string): string {
  const prefix = `${typeLabel}:`
  return routeName.startsWith(prefix)
    ? routeName.slice(prefix.length).trim()
    : routeName
}

export function getTransitRouteLabel(leg: TransitRouteLeg): string {
  const routeName = leg.routeName?.trim() || null
  if (leg.mode === 'WALK') return '도보'

  if (leg.mode === 'BUS') {
    const typeLabel =
      leg.routeType === null ? null : BUS_TYPE_LABELS[leg.routeType] ?? null
    if (typeLabel === null) return routeName === null ? '버스' : `버스 · ${routeName}`
    const number = routeName === null
      ? null
      : removeMatchingBusPrefix(routeName, typeLabel)
    return number === null || number.length === 0
      ? `버스 · ${typeLabel}`
      : `버스 · ${typeLabel} ${number}`
  }

  if (leg.mode === 'SUBWAY') {
    const officialLabel = leg.routeType === null
      ? null
      : SUBWAY_TYPE_LABELS[leg.routeType] ?? null
    return `지하철 · ${officialLabel ?? routeName ?? '노선 정보 없음'}`
  }

  if (leg.mode === 'TRAIN') {
    const officialLabel = leg.routeType === null
      ? null
      : TRAIN_TYPE_LABELS[leg.routeType] ?? null
    return `기차 · ${officialLabel ?? routeName ?? '열차 정보 없음'}`
  }

  return routeName === null
    ? MODE_LABELS[leg.mode]
    : `${MODE_LABELS[leg.mode]} · ${routeName}`
}

export function normalizeTmapRouteColor(color: string | null): string | null {
  if (color === null) return null
  const normalized = color.trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(normalized) ? `#${normalized}` : null
}
