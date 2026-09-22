import { Link } from 'react-router'

/**
 * Cloudflare's SPA fallback returns 200 for genuinely bad URLs, so this route
 * carries the noindex itself. React 19 hoists meta rendered anywhere in the
 * tree, so no helmet library is needed.
 */
export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <meta name="robots" content="noindex" />
      <title>Not found — devtools</title>
      <p className="font-mono text-[13px] text-muted">No tool lives at this URL.</p>
      <Link to="/" className="text-[13px] text-accent hover:underline">
        Back to all tools
      </Link>
    </div>
  )
}
