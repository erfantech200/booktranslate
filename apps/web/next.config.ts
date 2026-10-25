import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : '*.supabase.co';

const repoRoot = resolve(process.cwd(), '../..');

const config: NextConfig = {
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
