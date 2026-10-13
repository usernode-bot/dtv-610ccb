// Search and link-preview metadata: the <head> tags for each page (title,
// description, canonical link, Open Graph and Twitter card), robots.txt and
// a sitemap of every series page. All of it is public catalogue data.

import type { Request } from 'express';
import type { Pool } from 'pg';

export const SITE_NAME = 'Dtv';
export const SITE_DESCRIPTION = 'Watch movies and dramas together with the group.';
export const ICON_PATH = '/icons/icon-512.png';

export interface PageMeta {
  title: string;
  description: string;
  /** Path of the page, for the canonical link and og:url. */
  path: string;
  /** Absolute or root-relative image for link previews. */
  image?: string | null;
  type?: 'website' | 'video.tv_show';
}

export interface SeriesMetaRow {
  slug: string;
  title: string;
  synopsis: string;
  genre: string;
  coverUrl: string | null;
}

/**
 * The address this app is reached at, from the request (the edge passes the
 * original scheme and host on). Null when the host looks wrong.
 */
export function publicOrigin(req: Request): string | null {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!/^https?$/.test(proto) || !/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) return null;
  return proto + '://' + host;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

/** What a page path is about: a series page names its series, every other page is the app. */
export function metaForPath(path: string, series: SeriesMetaRow | null): PageMeta {
  if (series) {
    return {
      title: `${series.title} | ${SITE_NAME}`,
      description: clip(series.synopsis || `${series.title}${series.genre ? ', ' + series.genre : ''}, on ${SITE_NAME}.`, 160),
      path: '/series/' + encodeURIComponent(series.slug),
      image: series.coverUrl && /^https:\/\//.test(series.coverUrl) ? series.coverUrl : null,
      type: 'video.tv_show',
    };
  }
  if (/^\/my-list(\/|$)/.test(path)) return { title: `My List | ${SITE_NAME}`, description: SITE_DESCRIPTION, path: '/my-list' };
  return { title: SITE_NAME, description: SITE_DESCRIPTION, path: '/' };
}

/** The <head> tags for one page. Every value is escaped. */
export function renderHead(meta: PageMeta, origin: string | null): string {
  const abs = (p: string) => (/^https?:\/\//.test(p) || !origin ? p : origin + p);
  const image = abs(meta.image || ICON_PATH);
  const e = escapeHtml;
  return [
    `<title>${e(meta.title)}</title>`,
    `<meta name="description" content="${e(meta.description)}">`,
    origin ? `<link rel="canonical" href="${e(abs(meta.path))}">` : '',
    `<meta property="og:site_name" content="${e(SITE_NAME)}">`,
    `<meta property="og:type" content="${e(meta.type || 'website')}">`,
    `<meta property="og:title" content="${e(meta.title)}">`,
    `<meta property="og:description" content="${e(meta.description)}">`,
    origin ? `<meta property="og:url" content="${e(abs(meta.path))}">` : '',
    `<meta property="og:image" content="${e(image)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${e(meta.title)}">`,
    `<meta name="twitter:description" content="${e(meta.description)}">`,
  ].filter(Boolean).join('\n  ');
}

const HEAD_BLOCK = /<!-- dtv:head -->[\s\S]*?<!-- \/dtv:head -->/;

/** index.html with its default head block swapped for this page's tags. */
export function injectHead(html: string, head: string): string {
  return html.replace(HEAD_BLOCK, '<!-- dtv:head -->\n  ' + head + '\n  <!-- /dtv:head -->');
}

export async function loadSeriesMeta(pool: Pool, slug: string): Promise<SeriesMetaRow | null> {
  const { rows } = await pool.query(
    'SELECT slug, title, synopsis, genre, cover_url FROM series WHERE slug = $1', [slug]);
  return rows.length
    ? { slug: rows[0].slug, title: rows[0].title, synopsis: rows[0].synopsis, genre: rows[0].genre, coverUrl: rows[0].cover_url }
    : null;
}

export async function sitemapXml(pool: Pool, origin: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT s.slug, GREATEST(s.created_at, MAX(e.created_at)) AS updated
       FROM series s LEFT JOIN episodes e ON e.series_id = s.id
      GROUP BY s.id ORDER BY s.id`);
  const url = (loc: string, lastmod?: Date) =>
    `  <url><loc>${escapeHtml(origin + loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url('/'),
    ...rows.map((r) => url('/series/' + encodeURIComponent(r.slug), r.updated)),
    '</urlset>',
    '',
  ].join('\n');
}

export function robotsTxt(origin: string | null): string {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', origin ? `Sitemap: ${origin}/sitemap.xml` : '', '']
    .filter((l, i, a) => l || i === a.length - 1).join('\n');
}
