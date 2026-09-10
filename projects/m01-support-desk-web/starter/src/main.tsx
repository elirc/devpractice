import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createMockTicketApi } from './api/mockApi.js';

// M01 runs against the mock adapter. M02 replaces this ONE line with an
// adapter that talks to the real API; no component should need to change.
const api = createMockTicketApi({ latencyMs: 250 });

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);
