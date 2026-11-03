import type { SeoulSubwayArrivalRecord } from '../../src/domain/seoulSubway.js'

type UnknownRecord = Record<string, unknown>

export class SeoulSubwayResponseError extends Error {
  constructor(
    public readonly kind: 'provider' | 'invalid_response',
    public readonly providerCode: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'SeoulSubwayResponseError'
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

function parseSeoulDateTime(value: unknown): string | null {
  const text = readText(value)
  if (text === null) return null
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
  )
  if (match === null) return null
  const date = new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+09:00`,
  )
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function parseSeoulSubwayArrivals(
  text: string,
): SeoulSubwayArrivalRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new SeoulSubwayResponseError(
      'invalid_response',
      null,
      '서울시 지하철 JSON 응답을 해석할 수 없습니다.',
    )
  }
  if (!isRecord(parsed)) {
    throw new SeoulSubwayResponseError(
      'invalid_response',
      null,
      '서울시 지하철 응답이 객체가 아닙니다.',
    )
  }

  // 실측 결과 데이터 없음 응답은 errorMessage로 감싸지 않고
  // code/status/message가 최상위에 오는 별도 오류 객체를 사용한다.
  const responseState = isRecord(parsed.errorMessage)
    ? parsed.errorMessage
    : parsed
  const code = readText(responseState.code)
  if (code === null) {
    throw new SeoulSubwayResponseError(
      'invalid_response',
      null,
      '서울시 지하철 응답 상태가 없습니다.',
    )
  }
  if (code === 'INFO-200') return []
  if (code !== 'INFO-000') {
    throw new SeoulSubwayResponseError(
      'provider',
      code,
      readText(responseState.message) ?? '서울시 지하철 요청이 실패했습니다.',
    )
  }

  const list = parsed.realtimeArrivalList
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) {
    throw new SeoulSubwayResponseError(
      'invalid_response',
      null,
      '서울시 지하철 도착정보 목록이 배열이 아닙니다.',
    )
  }

  return list.map((value) => {
    if (!isRecord(value)) {
      throw new SeoulSubwayResponseError(
        'invalid_response',
        null,
        '서울시 지하철 도착정보 항목이 객체가 아닙니다.',
      )
    }
    const subwayId = readText(value.subwayId)
    const stationName = readText(value.statnNm)
    const upDownLine = readText(value.updnLine)
    const trainLineName = readText(value.trainLineNm)
    const arrivalSeconds = readNonNegativeInteger(value.barvlDt)
    const generatedAt = parseSeoulDateTime(value.recptnDt)
    const arrivalStatusCode = readText(value.arvlCd)
    const arrivalMessage = readText(value.arvlMsg2)
    if (
      subwayId === null ||
      stationName === null ||
      upDownLine === null ||
      trainLineName === null ||
      arrivalSeconds === null ||
      generatedAt === null ||
      arrivalStatusCode === null ||
      arrivalMessage === null
    ) {
      throw new SeoulSubwayResponseError(
        'invalid_response',
        null,
        '서울시 지하철 도착정보의 필수 값이 올바르지 않습니다.',
      )
    }
    return {
      subwayId,
      stationName,
      upDownLine,
      trainLineName,
      trainStatus: readText(value.btrainSttus),
      arrivalSeconds,
      generatedAt,
      arrivalStatusCode,
      arrivalMessage,
    }
  })
}
