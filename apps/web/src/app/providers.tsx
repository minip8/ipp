'use client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from 'next-themes';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiRequestError } from '@/lib/api';

function makeClient() {
  const onAuthError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.isUnauthorized && typeof window !== 'undefined') {
      const here = window.location.pathname + window.location.search;
      if (!here.startsWith('/sign-'))
        window.location.assign(`/sign-in?next=${encodeURIComponent(here)}`);
    }
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: onAuthError }),
    mutationCache: new MutationCache({ onError: onAuthError }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (count, err) => {
          if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) return false;
          return count < 2;
        },
      },
    },
  });
}

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            '!rounded-lg !border !border-border !bg-surface !text-fg !shadow-overlay !font-sans !text-sm',
          description: '!text-fg-muted',
        },
      }}
    />
  );
}

export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  const [client] = useState(makeClient);
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={400} skipDelayDuration={200}>
          {children}
          <ThemedToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
