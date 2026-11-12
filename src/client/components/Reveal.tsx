import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Phase = 'closed' | 'opening' | 'open' | 'closing'
const DURATION = 300

/**
 * Expands its children into place when `show` turns on and collapses them away when it turns
 * off (animating grid-template-rows 0fr <-> 1fr, so no height measuring). While collapsing it
 * keeps rendering the last children it had, then unmounts them.
 *
 * Spacing belongs on `className` (e.g. "pt-5"), not on the parent (`space-y-*`/`gap`), so the
 * gap collapses along with the content.
 */
export function Reveal({
  show,
  appear = false,
  className,
  children,
}: {
  show: boolean
  /** Animate in on first mount too (used for newly added list items). */
  appear?: boolean
  className?: string
  children: ReactNode
}) {
  const [phase, setPhase] = useState<Phase>(show && !appear ? 'open' : 'closed')
  const last = useRef(children)
  if (show) last.current = children

  useEffect(() => {
    if (show) {
      if (phase === 'open' || phase === 'opening') return
      // Render collapsed for a frame, then expand, so the transition has a start state.
      setPhase('closing')
      let raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => setPhase('opening'))
      })
      const t = setTimeout(() => setPhase('open'), DURATION + 50)
      return () => {
        cancelAnimationFrame(raf)
        clearTimeout(t)
      }
    }
    if (phase === 'closed') return
    setPhase('closing')
    const t = setTimeout(() => setPhase('closed'), DURATION)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  if (phase === 'closed') return null
  const expanded = phase === 'opening' || phase === 'open'
  return (
    <div
      className="grid grid-cols-1 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: expanded ? '1fr' : '0fr', opacity: expanded ? 1 : 0 }}
    >
      {/* Clip only while animating; once open, focus rings and AI outlines can overflow. */}
      <div className={cn('min-h-0', phase !== 'open' && 'overflow-hidden')}>
        <div className={className}>{show ? children : last.current}</div>
      </div>
    </div>
  )
}

/**
 * A list whose items expand in when added and collapse out when removed. Removed items stay
 * at their old position until their collapse finishes. Keys must be stable per item.
 */
export function RevealList({ items, className }: { items: { key: string; node: ReactNode }[]; className?: string }) {
  const rendered = useRef<{ key: string; node: ReactNode; leaving: boolean }[]>([])
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
  }, [])
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  const current = new Map(items.map((i) => [i.key, i]))
  const merged: typeof rendered.current = []
  const placed = new Set<string>()
  let next = 0
  const placeUpTo = (key?: string) => {
    while (next < items.length) {
      const it = items[next++]
      if (!placed.has(it.key)) {
        placed.add(it.key)
        merged.push({ ...it, leaving: false })
      }
      if (it.key === key) return
    }
  }
  for (const r of rendered.current) {
    if (current.has(r.key)) placeUpTo(r.key)
    else merged.push({ ...r, leaving: true })
  }
  placeUpTo()
  rendered.current = merged

  return (
    <>
      {merged.map((r) => (
        <LeavingAware
          key={r.key}
          show={!r.leaving}
          appear={mounted.current}
          className={className}
          onGone={() => {
            rendered.current = rendered.current.filter((x) => x.key !== r.key || !x.leaving)
            rerender()
          }}
        >
          {r.node}
        </LeavingAware>
      ))}
    </>
  )
}

/** Reveal that reports when it has finished collapsing. */
function LeavingAware({
  show,
  appear,
  className,
  onGone,
  children,
}: {
  show: boolean
  appear: boolean
  className?: string
  onGone: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (show) return
    const t = setTimeout(onGone, DURATION + 50)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])
  return (
    <Reveal show={show} appear={appear} className={className}>
      {children}
    </Reveal>
  )
}
