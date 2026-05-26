import type { Metadata } from 'next';
import './globals.css';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const metadata: Metadata = {
  title: 'Binance Data Dashboard',
  description: 'Real-time Premium Binance Futures Data',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://www.tradingview.com" />
        <link rel="preconnect" href="https://s3.tradingview.com" />
        <link rel="preconnect" href="https://data.tradingview.com" />
      </head>
      <body>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
