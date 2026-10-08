import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './fonts/fonts.css';
import './styles.css';
// The mock-up skins, after the base sheet so a skin can override it.
import './themes.css';

const rootEl = document.getElementById('root');
if (rootEl === null) {
  throw new Error('Missing #root element');
}

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
