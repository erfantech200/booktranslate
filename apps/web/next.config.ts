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

const config: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: publicSupabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicSupabaseKey,
  },
  transpilePackages: ['@bookbridge/core'],
  // The pipeline worker runs inside /api/worker/run. Native and large packages stay external
  // (required from node_modules at runtime) and their data files are traced into that function.
  outputFileTracingRoot: repoRoot,
  serverExternalPackages: ['@sparticuz/chromium', 'playwright-core', 'sharp', '@napi-rs/canvas', 'pdfjs-dist', 'heic-convert', 'pg'],
  outputFileTracingIncludes: {
    '/api/worker/run': [
      '../../packages/core/prompts/**/*',
      '../../packages/core/assets/fonts/**/*',
      './node_modules/@sparticuz/chromium/bin/**/*',
      // playwright-core reads these through computed paths the tracer cannot follow.
      './node_modules/playwright-core/browsers.json',
      './node_modules/playwright-core/package.json',
      './node_modules/playwright-core/lib/**/*',
      './node_modules/pdfjs-dist/standard_fonts/**/*',
      './node_modules/pdfjs-dist/cmaps/**/*',
    ],
  },
  // Vercel runs on glibc Linux: drop the musl builds of the native packages (~50 MB) to stay well
  // under the 250 MB function size limit.
  outputFileTracingExcludes: {
    // pnpm layout: paths start with ../../node_modules/.pnpm/ (globs don't cross dot-segments).
    '/api/worker/run': [
      '../../node_modules/.pnpm/@napi-rs+canvas-linux-x64-musl@*/**',
      '../../node_modules/.pnpm/@img+sharp-libvips-linuxmusl-x64@*/**',
      '../../node_modules/.pnpm/@img+sharp-linuxmusl-x64@*/**',
    ],
  },
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
