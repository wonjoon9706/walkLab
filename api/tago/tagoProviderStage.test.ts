import { describe, expect, it, vi } from 'vitest'
import { createTagoProvider, TagoProviderStageError } from './tagoProvider'

describe('TAGO provider 실패 단계', () => {
  it('응답 형식 오류에 인근 정류장 조회 단계를 보존한다', async () => {
    const provider = createTagoProvider({
      fetch: vi.fn().mockResolvedValue(new Response('{broken')),
      serviceKey: 'test-key',
    })

    await expect(provider.getNearbyStops(
      { latitude: 37.548, longitude: 127.055 },
      new AbortController().signal,
    )).rejects.toMatchObject<Partial<TagoProviderStageError>>({
      name: 'TagoProviderStageError',
      stage: 'nearby_stops',
    })
  })
})
