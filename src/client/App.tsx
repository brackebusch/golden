import { useEffect, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryForm } from '@/components/QueryForm'
import { ChartPanel } from '@/components/ChartPanel'
import { ChatPanel } from '@/components/ChatPanel'
import { AiSetup, AiSetupBar } from '@/components/AiSetup'
import { useExplorer } from '@/hooks/useExplorer'
import { api, type AppConfig } from '@/lib/api'
import { cn } from '@/lib/utils'

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
    api.config().then(setConfig).catch(() => setConfig({ aiEnabled: false, aiAutoRun: false }))
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
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          <section className="bg-background relative min-h-0 flex-[3] overflow-hidden rounded-lg border shadow-xs">
            <ChartPanel x={x} aiEnabled={!aiOff} />
          </section>
          <section
            className={cn('bg-background overflow-hidden rounded-lg border shadow-xs', collapsed ? 'flex-none' : 'min-h-[200px] flex-[2]')}
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
