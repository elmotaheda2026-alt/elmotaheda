import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './index.css'
import App from './App.tsx'

// HelmetProvider removed; not needed

// Disable accidental value changes when scrolling the mouse wheel over any number input
document.addEventListener(
  'wheel',
  () => {
    const activeEl = document.activeElement as HTMLInputElement | null;
    if (activeEl && activeEl.tagName === 'INPUT' && activeEl.type === 'number') {
      activeEl.blur();
    }
  },
  { passive: true, capture: true }
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
