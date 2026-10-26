import type { MetadataRoute } from 'next';

// Private app: nothing may be indexed (also X-Robots-Tag in next.config.ts and meta robots).
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] };
}
