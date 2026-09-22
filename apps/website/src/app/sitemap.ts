import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = source.getPages().map((page) => ({
    url: `https://n10.is${page.url}`,
  }));

  return [
    { url: 'https://n10.is' },
    { url: 'https://n10.is/beam' },
    { url: 'https://n10.is/orchestra' },
    ...docs,
  ];
}
