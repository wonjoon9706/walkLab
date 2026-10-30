import type {
  MovementAnalysis,
  MovementSegment,
} from '../../domain/movementAnalysis'

interface SpeedTimelineChartProps {
  movement: MovementAnalysis
}

const CHART_WIDTH = 800
const CHART_HEIGHT = 220
const CHART_TOP = 20
const CHART_BOTTOM = 180
const MAX_CHART_SPEED_MPS = 3.5

function getSegmentColor(segment: MovementSegment): string {
  if (segment.state === 'moving') return '#dcefe7'
  if (segment.state === 'stationary') return '#f8e2b8'
  return '#e7e9e8'
}

function buildChartData(
  segments: MovementSegment[],
  totalDurationSeconds: number,
) {
  let elapsedSeconds = 0
  let path = ''
  let previousWasVisible = false
  const chartSegments = segments.map((segment) => {
    const x = (elapsedSeconds / totalDurationSeconds) * CHART_WIDTH
    const width =
      (segment.durationSeconds / totalDurationSeconds) * CHART_WIDTH
    elapsedSeconds += segment.durationSeconds

    if (segment.speedMps === null || segment.state === 'uncertain') {
      previousWasVisible = false
    } else {
      const speed = Math.min(segment.speedMps, MAX_CHART_SPEED_MPS)
      const pointX = x + width
      const pointY =
        CHART_BOTTOM -
        (speed / MAX_CHART_SPEED_MPS) * (CHART_BOTTOM - CHART_TOP)
      path += `${previousWasVisible ? ' L' : ' M'} ${pointX} ${pointY}`
      previousWasVisible = true
    }

    return { segment, x, width }
  })

  return { chartSegments, path }
}

export function SpeedTimelineChart({ movement }: SpeedTimelineChartProps) {
  const totalDurationSeconds = movement.segments.reduce(
    (sum, segment) => sum + segment.durationSeconds,
    0,
  )

  if (totalDurationSeconds <= 0 || movement.segments.length === 0) {
    return <p className="page-description">표시할 구간 분석 데이터가 없습니다.</p>
  }

  const { chartSegments, path } = buildChartData(
    movement.segments,
    totalDurationSeconds,
  )

  return (
    <div className="speed-chart-container">
      <svg
        className="speed-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-labelledby="speed-chart-title speed-chart-description"
      >
        <title id="speed-chart-title">측정 시간에 따른 구간별 속도</title>
        <desc id="speed-chart-description">
          초록 배경은 이동, 주황 배경은 정지, 회색 배경은 판정 불가 구간입니다.
        </desc>
        {chartSegments.map(({ segment, x, width }) => (
          <rect
            key={`${segment.index}-${segment.startedAt}`}
            x={x}
            y={CHART_TOP}
            width={Math.max(width, 1)}
            height={CHART_BOTTOM - CHART_TOP}
            fill={getSegmentColor(segment)}
          />
        ))}
        <line x1="0" y1={CHART_BOTTOM} x2={CHART_WIDTH} y2={CHART_BOTTOM} className="chart-axis" />
        <line x1="0" y1={CHART_TOP} x2="0" y2={CHART_BOTTOM} className="chart-axis" />
        {path.length > 0 && <path d={path} className="speed-line" />}
        <text x="8" y="16" className="chart-label">3.5 m/s</text>
        <text x="8" y="205" className="chart-label">0 · 측정 시간</text>
      </svg>
      <p className="map-legend segment-legend">
        <span className="moving-segment-key">이동</span>
        <span className="stationary-segment-key">정지</span>
        <span className="uncertain-segment-key">판정 불가</span>
      </p>
    </div>
  )
}
