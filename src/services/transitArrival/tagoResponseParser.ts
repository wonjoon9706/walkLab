import type {
  TagoArrivalRecord,
  TagoCityCode,
  TagoStopCandidate,
  TagoStopRoute,
  TagoRouteStop,
  TagoRouteStopPage,
} from '../../domain/busArrival.js'

type UnknownRecord = Record<string, unknown>

interface ParsedTagoEnvelope {
  items: UnknownRecord[]
  totalCount: number
}

export class TagoResponseError extends Error {
  constructor(
    public readonly kind: 'provider' | 'invalid_response',
    public readonly providerCode: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'TagoResponseError'
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

function readNonNegativeInteger(value: unknown): number | null {
  const text = readText(value)
  if (text === null) return null
  const parsed = Number(text)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function readCoordinate(value: unknown, minimum: number, maximum: number): number | null {
  const text = readText(value)
  if (text === null) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function readXmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match === null ? null : decodeXmlText(match[1].trim())
}

function parseXmlItem(xml: string): UnknownRecord {
  const item: UnknownRecord = {}
  const tagPattern = /<([a-zA-Z][\w-]*)[^>]*>([^<]*)<\/\1>/g
  for (const match of xml.matchAll(tagPattern)) {
    item[match[1].toLowerCase()] = decodeXmlText(match[2].trim())
  }
  return item
}

function parseXmlEnvelope(text: string): ParsedTagoEnvelope {
  const authMessage = readXmlTag(text, 'returnAuthMsg')
  const authCode = readXmlTag(text, 'returnReasonCode')
  if (authMessage !== null || authCode !== null) {
    throw new TagoResponseError(
      'provider',
      authCode,
      authMessage ?? 'TAGO 인증 요청이 거부되었습니다.',
    )
  }

  const resultCode = readXmlTag(text, 'resultCode')
  if (resultCode === null) {
    throw new TagoResponseError(
      'invalid_response',
      null,
      'TAGO XML 응답에 결과코드가 없습니다.',
    )
  }
  if (resultCode !== '00') {
    throw new TagoResponseError(
      'provider',
      resultCode,
      readXmlTag(text, 'resultMsg') ?? 'TAGO 요청이 실패했습니다.',
    )
  }

  const items = [...text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map((match) => parseXmlItem(match[1]))
  const totalCount = readNonNegativeInteger(readXmlTag(text, 'totalCount')) ?? items.length
  if (totalCount > 0 && items.length === 0) {
    throw new TagoResponseError(
      'invalid_response',
      null,
      'TAGO XML 항목 형식이 올바르지 않습니다.',
    )
  }
  return { items, totalCount }
}

function parseJsonEnvelope(text: string): ParsedTagoEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new TagoResponseError(
      'invalid_response',
      null,
      'TAGO JSON 응답을 해석할 수 없습니다.',
    )
  }
  if (!isRecord(parsed)) {
    throw new TagoResponseError('invalid_response', null, 'TAGO JSON 응답이 객체가 아닙니다.')
  }

  const openApiError = parsed.OpenAPI_ServiceResponse
  if (isRecord(openApiError) && isRecord(openApiError.cmmMsgHeader)) {
    const header = openApiError.cmmMsgHeader
    throw new TagoResponseError(
      'provider',
      readText(header.returnReasonCode),
      readText(header.returnAuthMsg) ?? 'TAGO 인증 요청이 거부되었습니다.',
    )
  }

  const response = parsed.response
  if (!isRecord(response) || !isRecord(response.header)) {
    throw new TagoResponseError('invalid_response', null, 'TAGO JSON 응답 구조가 올바르지 않습니다.')
  }
  const resultCode = readText(response.header.resultCode)
  if (resultCode !== '00') {
    throw new TagoResponseError(
      'provider',
      resultCode,
      readText(response.header.resultMsg) ?? 'TAGO 요청이 실패했습니다.',
    )
  }
  const body = response.body
  if (!isRecord(body)) return { items: [], totalCount: 0 }
  const totalCount = readNonNegativeInteger(body.totalCount) ?? 0
  const itemsNode = body.items
  const itemNode = isRecord(itemsNode) ? itemsNode.item : null
  const items = Array.isArray(itemNode)
    ? itemNode.filter(isRecord)
    : isRecord(itemNode)
      ? [itemNode]
      : []
  if (totalCount > 0 && items.length === 0) {
    throw new TagoResponseError(
      'invalid_response',
      null,
      'TAGO JSON 항목 형식이 올바르지 않습니다.',
    )
  }
  return { items, totalCount }
}

function parseEnvelope(text: string): ParsedTagoEnvelope {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJsonEnvelope(trimmed)
  }
  if (trimmed.startsWith('<')) return parseXmlEnvelope(trimmed)
  throw new TagoResponseError(
    'invalid_response',
    null,
    'TAGO 응답이 JSON 또는 XML 형식이 아닙니다.',
  )
}

function ensureAllItemsParsed<T>(
  envelope: ParsedTagoEnvelope,
  values: Array<T | null>,
): T[] {
  const parsed = values.filter((value): value is T => value !== null)
  if (envelope.totalCount > 0 && parsed.length === 0) {
    throw new TagoResponseError(
      'invalid_response',
      null,
      'TAGO 응답 항목의 필수 값이 올바르지 않습니다.',
    )
  }
  return parsed
}

export function parseTagoCityCodes(text: string): TagoCityCode[] {
  const envelope = parseEnvelope(text)
  return ensureAllItemsParsed(envelope, envelope.items.map((item) => {
    const code = readText(item.citycode)
    const name = readText(item.cityname)
    return code === null || name === null ? null : { code, name }
  }))
}

export function parseTagoNearbyStops(text: string): TagoStopCandidate[] {
  const envelope = parseEnvelope(text)
  return ensureAllItemsParsed(envelope, envelope.items.map((item) => {
    const cityCode = readText(item.citycode)
    const nodeId = readText(item.nodeid)
    const name = readText(item.nodenm)
    const latitude = readCoordinate(item.gpslati, -90, 90)
    const longitude = readCoordinate(item.gpslong, -180, 180)
    if (
      cityCode === null ||
      nodeId === null ||
      name === null ||
      latitude === null ||
      longitude === null
    ) {
      return null
    }
    return {
      cityCode,
      nodeId,
      name,
      coordinate: { latitude, longitude },
      routes: [],
    }
  }))
}

export function parseTagoRoutesAtStop(text: string): TagoStopRoute[] {
  const envelope = parseEnvelope(text)
  return ensureAllItemsParsed(envelope, envelope.items.map((item) => {
    const routeId = readText(item.routeid)
    const routeName = readText(item.routeno)
    if (routeId === null || routeName === null) return null
    return { routeId, routeName, nextStopCoordinate: null }
  }))
}

export function parseTagoRouteStopsPage(text: string): TagoRouteStopPage {
  const envelope = parseEnvelope(text)
  const parsedStops = envelope.items.map((item) => {
    const routeId = readText(item.routeid)
    const nodeId = readText(item.nodeid)
    const name = readText(item.nodenm)
    if (routeId === null || nodeId === null || name === null) return null

    const latitude = readCoordinate(item.gpslati, -90, 90)
    const longitude = readCoordinate(item.gpslong, -180, 180)
    return {
      routeId,
      nodeId,
      name,
      sequence: readNonNegativeInteger(item.nodeord),
      coordinate: latitude === null || longitude === null
        ? null
        : { latitude, longitude },
      upDownCode: readText(item.updowncd),
    }
  })
  // 경유 정류장 하나라도 유실되면 순서가 이어진 것처럼 오판할 수 있으므로
  // 이 응답만큼은 일부 항목을 버리지 않고 전체를 형식 오류로 처리한다.
  if (parsedStops.some((stop) => stop === null)) {
    throw new TagoResponseError(
      'invalid_response',
      null,
      'TAGO 노선 경유 정류장 응답의 필수 값이 올바르지 않습니다.',
    )
  }
  const stops = parsedStops as TagoRouteStop[]
  return { stops, totalCount: envelope.totalCount }
}

export function parseTagoArrivals(text: string): TagoArrivalRecord[] {
  const envelope = parseEnvelope(text)
  return ensureAllItemsParsed(envelope, envelope.items.map((item) => {
    const nodeId = readText(item.nodeid)
    const nodeName = readText(item.nodenm)
    const routeId = readText(item.routeid)
    const routeName = readText(item.routeno)
    const routeType = readText(item.routetp)
    const arrivalSeconds = readNonNegativeInteger(item.arrtime)
    const remainingStops = readNonNegativeInteger(item.arrprevstationcnt)
    if (
      nodeId === null ||
      nodeName === null ||
      routeId === null ||
      routeName === null ||
      routeType === null ||
      arrivalSeconds === null ||
      remainingStops === null
    ) {
      return null
    }
    return {
      nodeId,
      nodeName,
      routeId,
      routeName,
      routeType,
      arrivalSeconds,
      remainingStops,
    }
  }))
}
