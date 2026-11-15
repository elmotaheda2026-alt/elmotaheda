import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './index.css'
import App from './App.tsx'

// HelmetProvider removed; not needed

// In Electron, route window.print() through Chromium's PDF print preview so Windows 11
// does not show "This app doesn't support print preview".
const electronApi = (window as unknown as {
  electronAPI?: {
    printPreviewCurrent?: (payload?: { title?: string }) => Promise<{ success: boolean; error?: string }>;
  };
}).electronAPI;

if (electronApi?.printPreviewCurrent) {
  window.print = () => {
    void electronApi.printPreviewCurrent({
      title: document.title || 'معاينة الطباعة - شركة المتحدة',
    });
  };
}

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
