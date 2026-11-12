import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { AlertCircle, ArrowUp, Check, Loader2, Play, RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Explorer } from '@/hooks/useExplorer'
import { useChat, type ChatItem, type ChatPart } from '@/hooks/useChat'
import { cn } from '@/lib/utils'

const SUGGESTIONS = [
  'Which schools in Washington produce the highest earners?',
  'How do earnings grow in the years after graduation, by degree type?',
  'Which fields of study pay best for Associate degrees?',
]

const md = {
  p: (props: object) => <p className="mb-2 last:mb-0" {...props} />,
  ul: (props: object) => <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0" {...props} />,
  ol: (props: object) => <ol className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0" {...props} />,
  strong: (props: object) => <strong className="font-semibold" {...props} />,
  code: (props: object) => <code className="bg-muted rounded px-1 py-0.5 text-[0.85em]" {...props} />,
}

function Part({ part, active, onAnswer, onGenerate, canAnswer }: {
  part: ChatPart
  active: boolean
  canAnswer: boolean
  onAnswer: (text: string) => void
  onGenerate: () => void
}) {
  switch (part.type) {
    case 'text':
      return (
        <div className="text-sm leading-relaxed">
          <Markdown components={md}>{part.text}</Markdown>
        </div>
      )
    case 'status':
      return (
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {active ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          {part.text}
        </div>
      )
    case 'question':
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium">{part.question}</p>
          <div className="flex flex-wrap gap-1.5">
            {part.options.map((o) => (
              <Button key={o} size="sm" variant="outline" className="h-auto py-1 whitespace-normal" disabled={!canAnswer} onClick={() => onAnswer(o)}>
                {o}
              </Button>
            ))}
          </div>
          {canAnswer && <p className="text-muted-foreground text-xs">Or type your own answer below.</p>}
        </div>
      )
    case 'spec':
      return (
        <div className="bg-background border-ai/60 flex items-start gap-3 rounded-md border px-3 py-2">
          <Sparkles className="text-ai mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">{part.autoRun ? 'Chart updated' : 'Form filled in'}</p>
            <p className="text-muted-foreground">{part.summary}</p>
          </div>
          {!part.autoRun && (
            <Button size="sm" className="bg-success hover:bg-success-hover text-white" onClick={onGenerate}>
              <Play /> Generate
            </Button>
          )}
        </div>
      )
    case 'error':
      return (
        <div className="text-destructive flex items-start gap-1.5 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {part.message}
        </div>
      )
  }
}

export function ChatPanel({ x }: { x: Explorer }) {
  const chat = useChat(x)
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [chat.items])

  const submit = (text = draft) => {
    if (!text.trim() || chat.busy) return
    void chat.send(text)
    setDraft('')
  }
  const lastIndex = chat.items.length - 1

  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {chat.items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div>
              <p className="font-medium">What would you like to explore today?</p>
              <p className="text-muted-foreground text-sm">Ask a question in plain English. Claude will fill in the form for you.</p>
            </div>
            <div className="flex max-w-2xl flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" className="text-muted-foreground h-auto py-1 font-normal whitespace-normal" onClick={() => submit(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {chat.items.map((item: ChatItem, i) =>
              item.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm">{item.text}</div>
                </div>
              ) : (
                <div key={i} className="bg-assistant max-w-[90%] space-y-2 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                  {item.parts.map((part, j) => (
                    <Part
                      key={j}
                      part={part}
                      active={item.streaming && j === item.parts.length - 1}
                      canAnswer={i === lastIndex && !chat.busy}
                      onAnswer={(t) => submit(t)}
                      onGenerate={() => void x.generate()}
                    />
                  ))}
                  {item.streaming && item.parts.length === 0 && (
                    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <Loader2 className="size-3 animate-spin" /> Thinking…
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          {chat.items.length > 0 && (
            <Button variant="ghost" size="icon" title="New conversation" onClick={chat.reset}>
              <RotateCcw />
            </Button>
          )}
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Ask about the data… (Enter to send, Shift+Enter for a new line)"
            className="max-h-32 min-h-10 resize-none"
            rows={1}
          />
          <Button size="icon" disabled={!draft.trim() || chat.busy} onClick={() => submit()} className={cn(chat.busy && 'opacity-60')}>
            {chat.busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </div>
  )
}
