import { useRef, useState, type ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Whether the text is cut off. scrollWidth rounds to whole pixels and misses sub-pixel
 * overflow (where the ellipsis is still drawn), so measure the text's natural width instead.
 */
function isTruncated(el: HTMLElement | null): boolean {
  if (!el) return false
  const probe = el.cloneNode(true) as HTMLElement
  Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', width: 'auto', maxWidth: 'none', overflow: 'visible' })
  el.parentElement?.appendChild(probe)
  const natural = probe.getBoundingClientRect().width
  probe.remove()
  return natural > el.getBoundingClientRect().width + 0.01
}

/**
 * Single-line text that truncates with an ellipsis and, only when it's actually cut off,
 * shows the full text in a tooltip on hover.
 */
export function TruncatedText({ text, className, children }: { text: string; className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => setOpen(next && isTruncated(ref.current))}
    >
      <TooltipTrigger asChild>
        <span ref={ref} className={cn('block truncate', className)}>
          {children ?? text}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-md">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
