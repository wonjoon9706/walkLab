import { describe, expect, it } from 'vitest'
import {
  formatDistance,
  formatDuration,
  formatKoreanArrivalTime,
  formatKoreanDateTime,
  formatPace,
  formatSpeed,
} from './format'

describe('기록 표시 형식', () => {
  it('UTC 날짜가 한국에서 다음 날이면 한국 날짜로 표시한다', () => {
    const formatted = formatKoreanDateTime('2026-10-29T15:30:00.000Z')

    expect(formatted).toContain('2026')
    expect(formatted).toContain('10')
    expect(formatted).toContain('30')
    expect(formatted).not.toContain('29')
  })

  it('예상 도착시각은 같은 날에는 시간만, 날짜가 바뀌면 내일을 표시한다', () => {
    expect(
      formatKoreanArrivalTime(
        '2026-11-02T01:38:00.000Z',
        new Date('2026-11-02T00:00:00.000Z'),
      ),
    ).toBe('오전 10:38')
    expect(
      formatKoreanArrivalTime(
        '2026-11-02T15:10:00.000Z',
        new Date('2026-11-02T14:50:00.000Z'),
      ),
    ).toContain('내일')
  })

  it('시간, 거리, 속도를 읽기 쉬운 단위로 표시한다', () => {
    expect(formatDuration(285)).toBe('4분 45초')
    expect(formatDistance(1234)).toBe('1.23 km')
    expect(formatSpeed(1.25)).toBe('4.50 km/h')
    expect(formatPace(285)).toBe('4:45 /km')
  })
})
