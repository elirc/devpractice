import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './App';
import { APP_NAME } from './config';
import { ApiRequestError } from './lib/api';
import './styles/global.css';

/**
 * Server state is refetched on focus and reconnect so a second device sees
 * changes without a manual reload (spec 9.4). WebSockets are unnecessary here.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 10_000,
      retry: (failureCount, error) => {
        // Never retry auth or client errors; they will not resolve themselves.
        if (error instanceof ApiRequestError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

document.title = APP_NAME;

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
