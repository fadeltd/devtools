import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyRich, copyText } from '@/lib/util/clipboard'
import { Button } from './Button'

function CopyFace({
  label,
  disabled,
  title,
  copy,
}: {
  label: string
  disabled: boolean
  title: string
  copy: () => Promise<boolean>
}) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      disabled={disabled}
      onClick={() => {
        // Called straight from the click handler: Safari refuses otherwise.
        void copy().then((ok) => {
          if (!ok) return
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      title={title}
    >
      {copied ? <Check size={14} className="text-add" aria-hidden /> : <Copy size={14} aria-hidden />}
      <span>{copied ? 'Copied' : label}</span>
    </Button>
  )
}

export function CopyButton({
  value,
  label = 'Copy',
  disabled,
}: {
  value: string
  label?: string
  disabled?: boolean
}) {
  return (
    <CopyFace
      label={label}
      title={label}
      disabled={disabled === true || value === ''}
      copy={() => copyText(value)}
    />
  )
}

/**
 * Copies rich text with a plain-text twin, so a paste into Slack, Google Docs
 * or Gmail keeps tables and formatting. `html` must already be built when the
 * button is clicked: the clipboard write has to happen in the click itself.
 */
export function RichCopyButton({
  html,
  text,
  label = 'Copy formatted',
  title,
  disabled,
}: {
  html: string
  text: string
  label?: string
  /** Say why when the button is disabled; a tooltip is all a disabled button has. */
  title?: string | undefined
  disabled?: boolean
}) {
  return (
    <CopyFace
      label={label}
      title={title ??`${label}: pastes as rich text, with tables kept`}
      disabled={disabled === true || html === ''}
      copy={() => copyRich(html, text)}
    />
  )
}
