import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyText } from '@/lib/util/clipboard'
import { Button } from './Button'

export function CopyButton({
  value,
  label = 'Copy',
  disabled,
}: {
  value: string
  label?: string
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      disabled={disabled === true || value === ''}
      onClick={() => {
        // Called straight from the click handler: Safari refuses otherwise.
        void copyText(value).then((ok) => {
          if (!ok) return
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      title={label}
    >
      {copied ? <Check size={14} className="text-add" aria-hidden /> : <Copy size={14} aria-hidden />}
      <span>{copied ? 'Copied' : label}</span>
    </Button>
  )
}
