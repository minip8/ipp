import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'interview++', template: '%s · interview++' },
  description: 'Practice coding interviews with an AI interviewer that watches you work.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfc' },
    { media: '(prefers-color-scheme: dark)', color: '#16171a' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Set by src/proxy.ts for the Content-Security-Policy (this makes every page dynamic).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
