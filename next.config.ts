import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  compress: true,
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    const contentSecurityPolicy = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' https://s3.tradingview.com",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https://www.tradingview.com https://s.tradingview.com",
      "upgrade-insecure-requests",
    ].join('; ');

    return [{
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ],
    }];
  },
};

export default nextConfig;
