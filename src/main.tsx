import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { SessionProvider } from './state/SessionContext';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* BASE_URL keeps routing correct whether the app is served from the
        domain root or from a /<repo>/ subpath on GitHub Pages. */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
