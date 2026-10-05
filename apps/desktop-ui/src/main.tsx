import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { I18nProvider } from './i18n';

const container = document.getElementById('root');
if (!container) throw new Error('no #root');
// StrictMode stays on: subscriptions are EventSource + fetch, both of which
// are safe to open twice on a remount (the extra connection is closed in
// cleanup synchronously). The old Tauri listen() race is gone with the shell
// relay.
createRoot(container).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
