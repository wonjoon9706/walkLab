import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceSearchResult } from '../../domain/walkingRoute'

const { searchKakaoPlacesMock } = vi.hoisted(() => ({
  searchKakaoPlacesMock: vi.fn(),
}))

vi.mock('../../app/env', () => ({
  publicEnvironment: { kakaoMapJavaScriptKey: 'test-key' },
}))

vi.mock('../../services/places/kakaoPlaceSearch', () => ({
  PlaceSearchError: class PlaceSearchError extends Error {},
  searchKakaoPlaces: searchKakaoPlacesMock,
}))

import { PlaceSearchPanel } from './PlaceSearchPanel'

const seoulResult: PlaceSearchResult = {
  id: 'seoul',
  name: '서울역',
  address: '서울 용산구',
  roadAddress: '서울 용산구 한강대로 405',
  categoryName: '교통 > 기차역',
  coordinate: { latitude: 37.5, longitude: 127.1 },
}

const busanResult: PlaceSearchResult = {
  id: 'busan',
  name: '부산역',
  address: '부산 동구',
  roadAddress: '부산 동구 중앙대로 206',
  coordinate: { latitude: 35.1, longitude: 129.0 },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  searchKakaoPlacesMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PlaceSearchPanel', () => {
  it('접힌 출발지를 눌러 검색 입력을 연다', () => {
    render(
      <PlaceSearchPanel
        idPrefix="origin"
        title="출발지"
        searchOrigin={null}
        selectedPlace={null}
        searchInitiallyOpen={false}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '출발지 변경' }))
    expect(screen.getByRole('combobox', { name: '장소명 또는 주소' })).toBeInTheDocument()
  })

  it('두 글자 입력 후 300ms가 지나면 추천 결과와 카테고리를 표시한다', async () => {
    searchKakaoPlacesMock.mockResolvedValue([seoulResult])
    render(
      <PlaceSearchPanel
        idPrefix="destination"
        title="목적지"
        searchOrigin={null}
        selectedPlace={null}
        onSelect={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox', { name: '장소명 또는 주소' })

    fireEvent.change(input, { target: { value: '서' } })
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(searchKakaoPlacesMock).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '서울' } })
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(searchKakaoPlacesMock).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))

    expect(searchKakaoPlacesMock).toHaveBeenCalledOnce()
    expect(screen.getByRole('option', { name: /서울역/ })).toHaveTextContent(
      '기차역',
    )
  })

  it('이전 검색 응답이 늦게 도착해도 최신 결과를 덮어쓰지 않는다', async () => {
    const first = deferred<PlaceSearchResult[]>()
    const second = deferred<PlaceSearchResult[]>()
    searchKakaoPlacesMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    render(
      <PlaceSearchPanel
        idPrefix="destination"
        title="목적지"
        searchOrigin={null}
        selectedPlace={null}
        onSelect={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox', { name: '장소명 또는 주소' })

    fireEvent.change(input, { target: { value: '서울' } })
    await act(() => vi.advanceTimersByTimeAsync(300))
    fireEvent.change(input, { target: { value: '부산' } })
    await act(() => vi.advanceTimersByTimeAsync(300))
    await act(async () => {
      second.resolve([busanResult])
      await Promise.resolve()
    })
    expect(screen.getByRole('option', { name: /부산역/ })).toBeInTheDocument()

    await act(async () => {
      first.resolve([seoulResult])
      await Promise.resolve()
    })
    expect(screen.queryByRole('option', { name: /서울역/ })).toBeNull()
    expect(screen.getByRole('option', { name: /부산역/ })).toBeInTheDocument()
  })

  it('방향키와 Enter로 결과를 선택한다', async () => {
    const onSelect = vi.fn()
    searchKakaoPlacesMock.mockResolvedValue([seoulResult, busanResult])
    render(
      <PlaceSearchPanel
        idPrefix="origin"
        title="출발지"
        searchOrigin={null}
        selectedPlace={null}
        onSelect={onSelect}
      />,
    )
    const input = screen.getByRole('combobox', { name: '장소명 또는 주소' })
    fireEvent.change(input, { target: { value: '서울역' } })
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(screen.getByRole('option', { name: /서울역/ })).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith(seoulResult)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('검색 영역 밖을 누르면 결과 목록을 닫는다', async () => {
    searchKakaoPlacesMock.mockResolvedValue([seoulResult])
    render(
      <>
        <PlaceSearchPanel
          idPrefix="destination"
          title="목적지"
          searchOrigin={null}
          selectedPlace={null}
          onSelect={vi.fn()}
        />
        <button type="button">바깥 영역</button>
      </>,
    )
    const input = screen.getByRole('combobox', { name: '장소명 또는 주소' })
    fireEvent.change(input, { target: { value: '서울역' } })
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: '바깥 영역' }))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('한글 조합 중에는 검색하지 않고 조합 완료 후 디바운스한다', async () => {
    searchKakaoPlacesMock.mockResolvedValue([seoulResult])
    render(
      <PlaceSearchPanel
        idPrefix="destination"
        title="목적지"
        searchOrigin={null}
        selectedPlace={null}
        onSelect={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox', { name: '장소명 또는 주소' })

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '서울' } })
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(searchKakaoPlacesMock).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(searchKakaoPlacesMock).toHaveBeenCalledOnce()
  })
})
