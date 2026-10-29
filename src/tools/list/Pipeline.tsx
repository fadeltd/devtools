import { ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select, Toggle } from '@/components/ui/Select'
import { formatCount } from '@/lib/util/bytes'
import { cn } from '@/lib/util/cn'
import { defaultOp, moveStep, OP_KINDS, OP_LABELS, summarizeOp, type OpKind, type Step } from './core/ops'
import type { StepStat } from './core/types'
import { OpControls } from './OpControls'

/**
 * The op-card column: one card per step, in run order, each showing what it
 * did to the line count. The counts are the point -- they show *which* step ate
 * your data.
 */
export function Pipeline({
  steps,
  stats,
  stale,
  onChange,
  onReshuffle,
}: {
  steps: readonly Step[]
  /** Parallel to `steps`; undefined for a disabled step or before the first run. */
  stats: readonly (StepStat | undefined)[]
  /** Counts belong to an older run while a newer one is in flight. */
  stale: boolean
  onChange: (steps: Step[]) => void
  onReshuffle: () => void
}) {
  const [dragFrom, setDragFrom] = useState<number>()

  const update = (i: number, patch: Partial<Step>) =>
    onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  function add(kind: OpKind) {
    onChange([...steps, { id: crypto.randomUUID(), op: defaultOp(kind), enabled: true }])
  }

  return (
    <div className="flex flex-col">
      {steps.map((step, i) => {
        const stat = stats[i]
        return (
          <section
            key={step.id}
            onDragOver={(e) => dragFrom !== undefined && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom !== undefined) onChange(moveStep(steps, dragFrom, i))
              setDragFrom(undefined)
            }}
            className={cn(
              'flex flex-col gap-1.5 border-b border-border px-3 py-2',
              dragFrom === i && 'opacity-40',
            )}
          >
            <header className="flex items-center gap-1">
              {/* Drag is a desktop nicety; the arrows are the touch path. */}
              <span
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  setDragFrom(i)
                }}
                onDragEnd={() => setDragFrom(undefined)}
                className="hidden cursor-grab text-faint md:block"
                title="Drag to reorder"
              >
                <GripVertical size={14} />
              </span>
              <span className="w-4 shrink-0 font-mono text-[11px] text-faint">{i + 1}</span>
              <Toggle checked={step.enabled} onChange={(enabled) => update(i, { enabled })}>
                <span className={cn('font-medium', step.enabled ? 'text-fg' : 'text-faint line-through')}>
                  {OP_LABELS[step.op.kind]}
                </span>
              </Toggle>
              <span className="flex-1" />
              <Button
                variant="ghost"
                aria-label="Move up"
                title="Move up"
                disabled={i === 0}
                onClick={() => onChange(moveStep(steps, i, i - 1))}
              >
                <ChevronUp size={14} />
              </Button>
              <Button
                variant="ghost"
                aria-label="Move down"
                title="Move down"
                disabled={i === steps.length - 1}
                onClick={() => onChange(moveStep(steps, i, i + 1))}
              >
                <ChevronDown size={14} />
              </Button>
              <Button
                variant="ghost"
                aria-label="Remove step"
                title="Remove step"
                onClick={() => onChange(steps.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </Button>
            </header>

            <p className="truncate text-[12px] text-muted" title={summarizeOp(step.op)}>
              {summarizeOp(step.op)}
            </p>

            <div className="flex flex-wrap items-end gap-1.5">
              <OpControls op={step.op} onChange={(op) => update(i, { op })} />
              {step.op.kind === 'shuffle' && <Button onClick={onReshuffle}>Shuffle again</Button>}
            </div>

            <footer className={cn('flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-faint', stale && 'opacity-50')}>
              {!step.enabled ? (
                <span>skipped</span>
              ) : stat ? (
                <>
                  <span>
                    {formatCount(stat.inLines)} → {formatCount(stat.outLines)} lines
                  </span>
                  {stat.outLines < stat.inLines && (
                    <Badge tone="add">−{formatCount(stat.inLines - stat.outLines)}</Badge>
                  )}
                  {stat.warning !== undefined && <Badge tone="warn">{stat.warning}</Badge>}
                  {stat.error !== undefined && (
                    <Badge tone="del" title="This step was skipped; the rest still ran">
                      {stat.error}
                    </Badge>
                  )}
                </>
              ) : null}
            </footer>
          </section>
        )
      })}

      <div className="px-3 py-2">
        <Select
          value=""
          onChange={(e) => {
            const kind = e.target.value
            if (kind !== '') add(kind as OpKind)
          }}
          className="w-full"
          aria-label="Add operation"
        >
          <option value="">+ Add operation</option>
          {OP_KINDS.map((k) => (
            <option key={k} value={k}>
              {OP_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}
