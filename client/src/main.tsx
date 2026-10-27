import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/ui';
import App from './App';
import './index.css';
import brand from './lib/brand';

document.title = brand.clubName;
document.querySelector<HTMLLinkElement>('link[rel=icon]')?.setAttribute('href', brand.favicon);

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2, refetchOnWindowFocus: true, staleTime: 15_000 },
    mutations: {
      onError: (e) => { if (e instanceof ApiError && e.status === 401) qc.invalidateQueries({ queryKey: ['me'] }); }, // expired session → back to sign in
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}><BrowserRouter><AuthProvider><ToastProvider><App /></ToastProvider></AuthProvider></BrowserRouter></QueryClientProvider>
  </React.StrictMode>,
);
