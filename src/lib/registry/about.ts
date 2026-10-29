import type { ToolSlug } from './index'

/**
 * One honest paragraph per tool: which edge cases it actually handles.
 * Rendered only into the prerendered HTML by scripts/seo.ts, so none of this
 * reaches an app chunk -- do not import it from src/. `Record<ToolSlug, …>`
 * makes typecheck fail when a tool has no paragraph.
 */
export const ABOUT: Record<ToolSlug, string> = {
  'diff': 'TODO',
  'text-stats': 'TODO',
  'base64': 'TODO',
  'list': 'TODO',
  'id-gen': 'TODO',
  'json': 'TODO',
  'html-text': 'TODO',
  'timestamp': 'TODO',
  'jwt': 'TODO',
  'url': 'TODO',
  'hash': 'TODO',
  'hmac': 'TODO',
  'slug': 'TODO',
  'text-bytes': 'TODO',
  'number': 'TODO',
  'unicode': 'TODO',
  'escape': 'TODO',
  'env': 'TODO',
  'color': 'TODO',
  'contrast': 'TODO',
  'lorem': 'TODO',
  'cron': 'TODO',
  'csv': 'TODO',
  'yaml-toml': 'TODO',
  'qr': 'TODO',
  'sql': 'TODO',
  'css': 'TODO',
}
