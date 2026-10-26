import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Accept Supabase's current names too (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY), so the Vercel
// variables can be named either way. Both values are public by design (RLS protects the data);
// they are inlined into the browser bundle via `env` below. The secret key is never listed here.
const publicSupabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const publicSupabaseKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

let supabaseHost = '*.supabase.co';
try {
  if (publicSupabaseUrl) supabaseHost = new URL(publicSupabaseUrl).host;
} catch {
  // Malformed URL: the proxy shows a setup page explaining it.
}

const repoRoot = resolve(process.cwd(), '../..');
const migrations = ['../../supabase/migrations/**/*'];

const config: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: publicSupabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicSupabaseKey,
  },
  transpilePackages: ['@coach/core'],
  outputFileTracingRoot: repoRoot,
  serverExternalPackages: ['pg'],
  // The migration runner reads supabase/migrations at runtime (computed path, invisible to the tracer).
  outputFileTracingIncludes: { '/api/admin/migrate': migrations, '/api/health': migrations },
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
