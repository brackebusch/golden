import { useCallback, useRef, useState } from 'react'
import type { ChatEvent, ChatRequest, FormContext, PendingAsk } from '@shared/chat'
import type { Explorer } from './useExplorer'

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  | { type: 'spec'; summary: string; autoRun: boolean }
  | { type: 'question'; question: string; options: string[] }
  | { type: 'error'; message: string }

export type ChatItem = { role: 'user'; text: string } | { role: 'assistant'; parts: ChatPart[]; streaming: boolean }

function formContext(x: Explorer): FormContext {
  return {
    datasetId: x.profile?.id ?? null,
    datasetName: x.profile?.name,
    chartType: x.chartType,
    spec: x.spec,
    incompatibleReason: x.compatibility && !x.compatibility.ok ? x.compatibility.reason : undefined,
  }
}

/** Read a text/event-stream response body as ChatEvents. */
async function* readEvents(res: Response): AsyncGenerator<ChatEvent> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    let i
    while ((i = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, i)
      buffer = buffer.slice(i + 2)
      const data = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (data) yield JSON.parse(data.slice(6)) as ChatEvent
    }
  }
}

export function useChat(x: Explorer) {
  const [items, setItems] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const history = useRef<unknown[]>([])
  const pending = useRef<PendingAsk | null>(null)
  const abort = useRef<AbortController | null>(null)
  // The explorer changes every render; read the latest one inside async callbacks.
  const explorer = useRef(x)
  explorer.current = x

  /** Apply a change to the in-progress assistant message. */
  const updateLast = (fn: (parts: ChatPart[]) => ChatPart[], streaming = true) =>
    setItems((all) => {
      const last = all[all.length - 1]
      if (!last || last.role !== 'assistant') return all
      return [...all.slice(0, -1), { role: 'assistant', parts: fn(last.parts), streaming }]
    })

  const send = useCallback(async (message: string) => {
    const text = message.trim()
    if (!text || abort.current) return
    setBusy(true)
    setItems((all) => [...all, { role: 'user', text }, { role: 'assistant', parts: [], streaming: true }])
    const ctrl = new AbortController()
    abort.current = ctrl

    const body: ChatRequest = { history: history.current, pending: pending.current, message: text, form: formContext(explorer.current) }
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `Chat request failed (${res.status})`)
      }
      for await (const e of readEvents(res)) {
        switch (e.type) {
          case 'text':
            updateLast((parts) => {
              const last = parts[parts.length - 1]
              return last?.type === 'text' ? [...parts.slice(0, -1), { type: 'text', text: last.text + e.delta }] : [...parts, { type: 'text', text: e.delta }]
            })
            break
          case 'status':
            updateLast((parts) => [...parts, { type: 'status', text: e.text }])
            break
          case 'question':
            updateLast((parts) => [...parts, { type: 'question', question: e.question, options: e.options }])
            break
          case 'spec':
            updateLast((parts) => [...parts, { type: 'spec', summary: e.summary, autoRun: e.autoRun }])
            void explorer.current.applySpec(e.spec, { run: e.autoRun })
            break
          case 'error':
            updateLast((parts) => [...parts, { type: 'error', message: e.message }])
            break
          case 'done':
            history.current = e.history
            pending.current = e.pending
            break
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) updateLast((parts) => [...parts, { type: 'error', message: err instanceof Error ? err.message : String(err) }])
    } finally {
      updateLast((parts) => parts, false)
      abort.current = null
      setBusy(false)
    }
  }, [])

  const reset = useCallback(() => {
    abort.current?.abort()
    history.current = []
    pending.current = null
    setItems([])
  }, [])

  return { items, busy, send, reset }
}
