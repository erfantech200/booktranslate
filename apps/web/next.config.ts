import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : '*.supabase.co';

const config: NextConfig = {
  transpilePackages: ['@bookbridge/core'],
  // Uploads go straight from the browser to Supabase Storage, never through Vercel functions.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            `connect-src 'self' https://${supabaseHost} wss://${supabaseHost}`,
            `img-src 'self' data: blob: https://${supabaseHost}`,
            "style-src 'self' 'unsafe-inline'",
            `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
            "font-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            `form-action 'self' https://${supabaseHost}`,
          ].join('; '),
        },
      ],
    }];
  },
};

export default withNextIntl(config);
