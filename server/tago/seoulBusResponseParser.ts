import type {
  SeoulBusRoute,
  SeoulBusStop,
  SeoulRouteStopArrival,
} from '../../src/domain/seoulBus.js'

type UnknownRecord = Record<string, unknown>

export class SeoulBusResponseError extends Error {
  constructor(
    public readonly kind: 'provider' | 'invalid_response',
    public readonly providerCode: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'SeoulBusResponseError'
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function readInteger(value: unknown): number | null {
  const text = readText(value)
  if (text === null) return null
  const parsed = Number(text)
  return Number.isInteger(parsed) ? parsed : null
}

function readNonNegativeInteger(value: unknown): number | null {
  const parsed = readInteger(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

function readCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  const text = readText(value)
  if (text === null) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}

function parseEnvelope(text: string): UnknownRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // 인증 실패는 resultType=json 요청에도 XML 오류 봉투로 올 수 있다.
    // 오류 코드만 읽으며 XML 정상 데이터나 외부 엔티티는 해석하지 않는다.
    const code = text.match(/<(?:headerCd|returnReasonCode)>\s*([^<]+)\s*<\/(?:headerCd|returnReasonCode)>/i)?.[1]?.trim()
    const message = text.match(/<(?:headerMsg|returnAuthMsg)>\s*([^<]+)\s*<\/(?:headerMsg|returnAuthMsg)>/i)?.[1]?.trim()
    if (code !== undefined && code !== '0' && message !== undefined) {
      throw new SeoulBusResponseError('provider', code, message)
    }
    throw new SeoulBusResponseError(
      'invalid_response',
      null,
      '서울시 버스 JSON 응답을 해석할 수 없습니다.',
    )
  }
  if (!isRecord(parsed)) {
    throw new SeoulBusResponseError(
      'invalid_response',
      null,
      '서울시 버스 응답이 객체가 아닙니다.',
    )
  }
  const header = parsed.msgHeader
  if (!isRecord(header)) {
    throw new SeoulBusResponseError(
      'invalid_response',
      null,
      '서울시 버스 응답 헤더가 없습니다.',
    )
  }
  const headerCode = readText(header.headerCd)
  if (headerCode !== '0') {
    throw new SeoulBusResponseError(
      'provider',
      headerCode,
      readText(header.headerMsg) ?? '서울시 버스 요청이 실패했습니다.',
    )
  }
  const body = parsed.msgBody
  if (!isRecord(body)) return []
  const itemList = body.itemList
  // 실측 응답은 itemCount가 0이어도 itemList가 존재할 수 있어 배열을 기준으로 한다.
  if (Array.isArray(itemList)) return itemList.filter(isRecord)
  return isRecord(itemList) ? [itemList] : []
}

function requireAllParsed<T>(
  items: UnknownRecord[],
  values: Array<T | null>,
): T[] {
  if (values.some((value) => value === null)) {
    throw new SeoulBusResponseError(
      'invalid_response',
      null,
      '서울시 버스 응답 항목의 필수 값이 올바르지 않습니다.',
    )
  }
  return values as T[]
}

export function parseSeoulNearbyStops(text: string): SeoulBusStop[] {
  const items = parseEnvelope(text)
  return requireAllParsed(items, items.map((item) => {
    const stopId = readText(item.stId ?? item.stationId)
    const arsId = readText(item.arsId)
    const name = readText(item.stNm ?? item.stationNm ?? item.stnNm)
    const longitude = readCoordinate(item.tmX ?? item.gpsX, -180, 180)
    const latitude = readCoordinate(item.tmY ?? item.gpsY, -90, 90)
    if (
      stopId === null ||
      arsId === null ||
      name === null ||
      longitude === null ||
      latitude === null
    ) {
      return null
    }
    return {
      stopId,
      arsId,
      name,
      coordinate: { latitude, longitude },
    }
  }))
}

export function parseSeoulRoutesAtStop(text: string): SeoulBusRoute[] {
  const items = parseEnvelope(text)
  return requireAllParsed(items, items.map((item) => {
    const routeId = readText(item.busRouteId)
    const routeName = readText(item.busRouteNm ?? item.rtNm)
    if (routeId === null || routeName === null) return null
    return {
      routeId,
      routeName,
      routeType: readText(item.busRouteType ?? item.routeType),
    }
  }))
}

function parseArrivalEstimate(
  item: UnknownRecord,
  order: 1 | 2,
  stopSequence: number,
) {
  const suffix = String(order)
  const arrivalSeconds = readNonNegativeInteger(item[`arrmsgSec${suffix}`])
  const travelSeconds = readNonNegativeInteger(item[`traTime${suffix}`])
  const seconds = arrivalSeconds ?? (
    travelSeconds === null ? null : travelSeconds
  )
  const sectionSequence = readNonNegativeInteger(item[`sectOrd${suffix}`])
  if (seconds === null) return null
  const message = readText(item[`arrmsg${suffix}`])
  const departureWaiting = message?.normalize('NFKC').replace(/\s+/g, '') ===
    '출발대기'
  const remainingStops = departureWaiting || sectionSequence === null
    ? null
    : Math.max(0, stopSequence - sectionSequence)
  return {
    order,
    arrivalSeconds: seconds,
    remainingStops,
    message,
    serviceStatus: departureWaiting ? 'departure_waiting' as const : 'in_service' as const,
    rawStopSequence: stopSequence,
    rawSectionSequence: sectionSequence,
    arrivalTimeStatus: departureWaiting || (
      seconds === 0 && remainingStops !== null && remainingStops > 0
    )
      ? 'review_required' as const
      : 'estimated' as const,
  }
}

export function parseSeoulRouteArrivals(
  text: string,
): SeoulRouteStopArrival[] {
  const items = parseEnvelope(text)
  return requireAllParsed(items, items.map((item) => {
    const routeId = readText(item.busRouteId)
    const routeName = readText(item.rtNm ?? item.busRouteAbrv)
    const stopId = readText(item.stId)
    const stopName = readText(item.stNm)
    const sequence = readNonNegativeInteger(item.staOrd)
    if (
      routeId === null ||
      routeName === null ||
      stopId === null ||
      stopName === null ||
      sequence === null
    ) {
      return null
    }
    const estimates = [
      parseArrivalEstimate(item, 1, sequence),
      parseArrivalEstimate(item, 2, sequence),
    ].filter((estimate): estimate is NonNullable<typeof estimate> =>
      estimate !== null,
    )
    return {
      routeId,
      routeName,
      routeType: readText(item.routeType),
      stopId,
      arsId: readText(item.arsId),
      stopName,
      sequence,
      estimates,
    }
  }))
}
