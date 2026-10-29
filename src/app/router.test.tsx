import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from './router'

function renderRoute(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('기본 라우팅', () => {
  it.each([
    ['/', '측정 홈'],
    ['/login', '이메일 OTP 로그인'],
    ['/history', '기록 목록'],
    ['/sessions/test-session', '기록 상세'],
  ])('%s 경로에서 %s 화면을 표시한다', (path, heading) => {
    renderRoute(path)

    expect(
      screen.getByRole('heading', { level: 1, name: heading }),
    ).toBeInTheDocument()
  })

  it('상세 경로의 세션 ID를 표시한다', () => {
    renderRoute('/sessions/test-session')

    expect(screen.getByText('세션 ID: test-session')).toBeInTheDocument()
  })
})
