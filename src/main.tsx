import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouter } from './app/router'
import './styles.css'

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('WalkLab을 표시할 root 요소를 찾을 수 없습니다.')
}

createRoot(rootElement).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
