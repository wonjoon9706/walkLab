import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TransitRoutePanel } from './TransitRoutePanel'

vi.mock('./KakaoTransitRoutePanel', () => ({
  KakaoTransitRoutePanel: () => <div>카카오 대중교통</div>,
}))
afterEach(() => vi.unstubAllEnvs())
describe('단일 대중교통 UI', () => {
  it.each(['development', 'production', 'preview'])('%s 환경에서 카카오 화면을 표시한다', (mode) => {
    vi.stubEnv('MODE', mode)
    vi.stubEnv('DEV', mode === 'development')
    vi.stubEnv('PROD', mode !== 'development')
    render(<TransitRoutePanel active origin={{ latitude: 37.5, longitude: 127 }}
      destination={{ id: 'test', name: '목적지', address: '테스트', roadAddress: null,
        coordinate: { latitude: 37.51, longitude: 127.01 } }} speedModel={null} />)
    expect(screen.getByText('카카오 대중교통')).toBeInTheDocument()
  })
})
