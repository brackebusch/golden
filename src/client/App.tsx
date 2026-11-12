import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryForm } from '@/components/QueryForm'
import { ChartPanel } from '@/components/ChartPanel'
import { ChatPanel } from '@/components/ChatPanel'
import { AiSetup, AiSetupBar } from '@/components/AiSetup'
import { useExplorer } from '@/hooks/useExplorer'
import { api, type AppConfig } from '@/lib/api'
import { cn } from '@/lib/utils'
import { chartBox } from '@/lib/chartOptions'
import type { Explorer } from '@/hooks/useExplorer'

const GAP = 12 // gap-3 between the chart and chat sections
const MIN_CHAT = 220
const MIN_CHART = 280
/** Chart title row + padding above the plot. */
const CHART_HEADER = 76
/** Height for "no chart yet", errors and empty results. */
const PLACEHOLDER_HEIGHT = 300

function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

/**
 * Chart section size: as big as the chart can use, then the chat gets the rest. Width-limited
 * charts get shorter (freeing height for chat); height-limited ones (chat keeps MIN_CHAT) get
 * narrower instead, keeping their proportions.
 */
function chartSectionSize(x: Explorer, area: { w: number; h: number }) {
  const maxH = Math.max(MIN_CHART, area.h - GAP - MIN_CHAT)
  const run = x.lastRun
  const box =
    run && run.result.rows.length > 0 && !x.runError ? chartBox(run.spec, run.result) : { height: PLACEHOLDER_HEIGHT - CHART_HEADER }
  if ('height' in box) return { width: area.w, height: Math.max(MIN_CHART, Math.min(box.height + CHART_HEADER, maxH)) }
  const height = Math.max(MIN_CHART, Math.min(maxH, area.w / box.aspect + CHART_HEADER))
  return { width: Math.min(area.w, (height - CHART_HEADER) * box.aspect), height }
}

const SETUP_HIDDEN_KEY = 'golden:ai-setup-hidden'
const readHidden = () => {
  try {
    return localStorage.getItem(SETUP_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  const x = useExplorer()
  const [config, setConfig] = useState<AppConfig | null>(null)
  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => setConfig({ aiEnabled: false, aiAutoRun: false }))
  }, [])
  const [setupHidden, setSetupHidden] = useState(readHidden)
  const hideSetup = (hidden: boolean) => {
    setSetupHidden(hidden)
    try {
      localStorage.setItem(SETUP_HIDDEN_KEY, hidden ? '1' : '0')
    } catch {
      /* storage unavailable: just don't remember */
    }
  }
  const aiOff = config !== null && !config.aiEnabled
  const collapsed = aiOff && setupHidden
  const mainRef = useRef<HTMLElement>(null)
  const area = useSize(mainRef)
  // With the chat collapsed to a bar there's nothing to give space to: the chart just fills.
  const chartSize = area.h > 0 && !collapsed ? chartSectionSize(x, area) : null

  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-muted/30 flex h-screen">
        <aside className="bg-background flex w-1/4 min-w-[300px] max-w-[420px] flex-col border-r">
          <header className="flex items-baseline gap-2 border-b px-4 py-3">
            <h1 className="text-lg font-semibold tracking-tight">Golden</h1>
            <span className="text-muted-foreground text-xs">Explore Washington open data</span>
          </header>
          <div className="min-h-0 flex-1">
            <QueryForm x={x} />
          </div>
        </aside>
        <main ref={mainRef} className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          <section
            className={cn(
              'bg-background relative min-h-0 self-center overflow-hidden rounded-lg border shadow-xs transition-[width,height] duration-300 ease-out',
              chartSize ? 'flex-none' : 'w-full flex-1',
            )}
            style={chartSize ?? undefined}
          >
            <ChartPanel x={x} aiEnabled={!aiOff} />
          </section>
          <section
            className={cn('bg-background overflow-hidden rounded-lg border shadow-xs', collapsed ? 'flex-none' : 'min-h-[220px] flex-1')}
          >
            {!aiOff ? (
              <ChatPanel x={x} />
            ) : collapsed ? (
              <AiSetupBar onExpand={() => hideSetup(false)} />
            ) : (
              <AiSetup onCollapse={() => hideSetup(true)} />
            )}
          </section>
        </main>
      </div>
    </TooltipProvider>
  )
}
