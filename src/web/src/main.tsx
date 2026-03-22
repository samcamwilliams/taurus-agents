import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { registerPwaServiceWorker } from './pwa';
import { ThemeProvider } from './hooks/useTheme';
import { PreferencesProvider } from './hooks/usePreferences';
import './styles/global.scss';

registerPwaServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <PreferencesProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PreferencesProvider>
    </ThemeProvider>
  </StrictMode>,
);
