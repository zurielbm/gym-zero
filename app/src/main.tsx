import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initSync } from './data/sync'
import './styles.css'

initSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
