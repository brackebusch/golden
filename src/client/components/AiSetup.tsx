import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, MessageSquare, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

const CONSOLE_URL = 'https://platform.claude.com'
const KEYS_URL = 'https://platform.claude.com/settings/keys'
const CLAUDE_BILLING_URL = 'https://claude.ai/settings/billing'
const ENV_LINE = 'ANTHROPIC_API_KEY='

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-foreground inline-flex items-center gap-0.5 font-medium underline underline-offset-2">
      {children}
      <ExternalLink className="size-3" />
    </a>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium">{n}</span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <div className="text-muted-foreground text-xs leading-relaxed">{children}</div>
      </div>
    </li>
  )
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="bg-muted mt-1 flex items-center justify-between gap-2 rounded-md px-2 py-1 font-mono text-xs">
      <span className="text-foreground truncate">
        {text}
        <span className="text-muted-foreground">sk-ant-…</span>
      </span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

/** Slim bar shown when the setup guide is collapsed, so the chart gets the space. */
export function AiSetupBar({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <MessageSquare className="size-4 opacity-60" />
        Chat with Claude is off. Add an API key to ask questions in plain English.
      </p>
      <Button variant="ghost" size="sm" onClick={onExpand}>
        How to set it up <ChevronUp />
      </Button>
    </div>
  )
}

/** Shown in place of the chat when no ANTHROPIC_API_KEY is configured. */
export function AiSetup({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-medium">
              <Sparkles className="text-ai size-4" /> Chat with Claude is turned off
            </h2>
            <p className="text-muted-foreground text-sm">
              Everything else works without it: build a query on the left and click Generate. Add an API key to ask questions in plain English instead.
            </p>
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground shrink-0" onClick={onCollapse}>
            Hide <ChevronDown />
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="space-y-3">
            <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Set up (about 5 minutes)</h3>
            <ol className="space-y-3">
              <Step n={1} title="Get API access">
                <ul className="mt-0.5 list-disc space-y-1 pl-4">
                  <li>
                    <b>On Claude Max, Ultra or Team:</b> your plan includes monthly API credits. On{' '}
                    <Link href={CLAUDE_BILLING_URL}>claude.ai</Link>, open <b>Settings → Billing</b> and link a Claude Console organization under API credits.
                  </li>
                  <li>
                    <b>On Free, Pro or Enterprise:</b> create an account at <Link href={CONSOLE_URL}>platform.claude.com</Link> and add credits under{' '}
                    <b>Billing</b>.
                  </li>
                </ul>
                <p className="mt-1">A question usually costs a few cents.</p>
              </Step>
              <Step n={2} title="Create an API key">
                Go to <Link href={KEYS_URL}>Settings → API keys</Link> in the same organization that holds your credits, create a key, and copy it. It's shown only once.
              </Step>
              <Step n={3} title="Add it to .env">
                In the project folder, open <code className="text-foreground">.env</code> (copy <code className="text-foreground">.env.example</code> if it doesn't exist) and paste
                your key after:
                <CopyLine text={ENV_LINE} />
              </Step>
              <Step n={4} title="Restart the server">
                Stop <code className="text-foreground">npm run dev</code> (Ctrl+C) and start it again. The key is only read at startup.
              </Step>
            </ol>
          </section>

          <section className="space-y-3">
            <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">What you get</h3>
            <ul className="text-muted-foreground space-y-2.5 text-sm">
              <li>
                <span className="text-foreground font-medium">Ask in plain English.</span> For example, "Which schools in Washington produce the highest earners?"
              </li>
              <li>
                <span className="text-foreground font-medium">Claude fills in the form.</span> It asks a quick question when something is ambiguous, then fills in the fields
                (marked <Sparkles className="text-ai inline size-3" /> AI). You review them and click Generate.
              </li>
              <li>
                <span className="text-foreground font-medium">Refine with follow-ups.</span> "Only Bachelor's degrees" or "split by years after graduation" adjust the
                current query.
              </li>
              <li>
                <span className="text-foreground font-medium">Smarter defaults.</span> Each dataset's columns are classified once, so the form suggests meaningful values
                and never offers things like "average of an ID".
              </li>
              <li className="text-xs">Your key stays on your machine: it's read by the local server and never sent to the browser.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
