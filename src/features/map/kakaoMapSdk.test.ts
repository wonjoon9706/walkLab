import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadKakaoMapSdk,
  resetKakaoMapSdkForTest,
  type KakaoMapsNamespace,
} from './kakaoMapSdk'

afterEach(() => {
  document.getElementById('walklab-kakao-map-sdk')?.remove()
  delete window.kakao
  resetKakaoMapSdkForTest()
})

describe('카카오맵 SDK 로더', () => {
  it('autoload=false 스크립트를 한 번만 추가하고 maps.load 완료를 기다린다', async () => {
    const maps = {
      load: vi.fn((callback: () => void) => callback()),
    } as unknown as KakaoMapsNamespace

    const firstRequest = loadKakaoMapSdk('test-javascript-key')
    const secondRequest = loadKakaoMapSdk('test-javascript-key')
    const script = document.getElementById(
      'walklab-kakao-map-sdk',
    ) as HTMLScriptElement

    expect(firstRequest).toBe(secondRequest)
    expect(document.querySelectorAll('#walklab-kakao-map-sdk')).toHaveLength(1)
    expect(script.src).toContain('autoload=false')
    expect(script.src).toContain('appkey=test-javascript-key')

    window.kakao = { maps }
    script.dispatchEvent(new Event('load'))

    await expect(firstRequest).resolves.toBe(maps)
    expect(maps.load).toHaveBeenCalledOnce()
  })

  it('스크립트 로딩 실패를 호출자에게 전달한다', async () => {
    const request = loadKakaoMapSdk('test-javascript-key')
    const script = document.getElementById('walklab-kakao-map-sdk')

    script?.dispatchEvent(new Event('error'))

    await expect(request).rejects.toThrow('KAKAO_MAP_SDK_LOAD_FAILED')
  })
})
