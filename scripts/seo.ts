/**
 * Post-build SEO pass, driven entirely off the tool registry.
 *
 * A client-only SPA serves one empty <div id="root"> for every URL, which is
 * this architecture's biggest SEO weakness. So after `vite build` we write a
 * real HTML file per tool route, each with its own title, description,
 * canonical, Open Graph tags, JSON-LD and an <h1> plus a static summary.
 *
 * This composes with Cloudflare rather than fighting it: real assets take
 * priority over `not_found_handling`, so /diff serves the prerendered file
 * while an unknown path still falls through to the SPA shell. Client-side
 * navigation is untouched -- these files only ever serve cold loads.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { VISIBLE_TOOLS } from '../src/lib/registry/index'
import { CATEGORY_LABELS } from '../src/lib/registry/types'

const SITE = 'https://devtools.fadeltd.dev'
const DIST = join(process.cwd(), 'dist')

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function headFor(tool: (typeof VISIBLE_TOOLS)[number]): string {
  const title = `${tool.title} — devtools`
  const url = `${SITE}/${tool.slug}`
  const desc = tool.blurb
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: tool.title,
    description: desc,
    url,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }

  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(desc)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="devtools.fadeltd.dev" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  ].join('\n    ')
}

/**
 * Static content inside #root. React's createRoot clears the container on
 * mount, so this is purely what a crawler (or a user on a slow connection)
 * sees first. Keep it honest: it describes the tool, it does not fake the UI.
 */
function bodyFor(tool: (typeof VISIBLE_TOOLS)[number]): string {
  return [
    '<div class="prerender">',
    `<h1>${escapeHtml(tool.title)}</h1>`,
    `<p>${escapeHtml(tool.blurb)}</p>`,
    `<p>Category: ${escapeHtml(CATEGORY_LABELS[tool.category])}.`,
    ` Runs entirely in your browser — nothing you paste is uploaded.</p>`,
    `<p>Also handles: ${escapeHtml(tool.keywords.join(', '))}.</p>`,
    '</div>',
  ].join('\n      ')
}

async function main() {
  const shell = await readFile(join(DIST, 'index.html'), 'utf8')

  // Replace the shell's head block between <title> and the last meta we own.
  const headStart = shell.indexOf('<title>')
  const headEnd = shell.indexOf('<meta name="twitter:card"')
  if (headStart === -1 || headEnd === -1) {
    throw new Error('seo: could not locate the head block in dist/index.html')
  }
  const headEndClose = shell.indexOf('/>', headEnd) + 2

  await Promise.all(
    VISIBLE_TOOLS.map(async (tool) => {
      const html =
        shell.slice(0, headStart) +
        headFor(tool) +
        shell.slice(headEndClose).replace(
          '<div id="root"></div>',
          `<div id="root">\n      ${bodyFor(tool)}\n    </div>`,
        )

      const dir = join(DIST, tool.slug)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'index.html'), html, 'utf8')
    }),
  )
  const written = VISIBLE_TOOLS.length

  const now = new Date().toISOString().slice(0, 10)
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${SITE}/</loc><lastmod>${now}</lastmod><priority>1.0</priority></url>`,
    ...VISIBLE_TOOLS.map(
      (t) =>
        `  <url><loc>${SITE}/${t.slug}</loc><lastmod>${now}</lastmod><priority>0.8</priority></url>`,
    ),
    '</urlset>',
    '',
  ].join('\n')
  await writeFile(join(DIST, 'sitemap.xml'), sitemap, 'utf8')

  console.log(`seo: prerendered ${written} tool pages + sitemap.xml`)
}

await main()
