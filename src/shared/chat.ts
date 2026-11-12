import type { QuerySpec } from './querySpec'

/** What the form looks like when the user sends a message; given to the AI as context. */
export interface FormContext {
  datasetId: string | null
  datasetName?: string
  chartType: string
  /** null when the dataset and chart type are incompatible (form is blocked). */
  spec: QuerySpec | null
  incompatibleReason?: string
}

/** A clarifying question waiting for the user's answer (the AI's ask_user tool call). */
export interface PendingAsk {
  toolUseId: string
  /** Results of any other tools called in the same turn, sent along with the answer. */
  otherResults: unknown[]
}

export interface ChatRequest {
  /** Opaque API conversation history returned by the previous `done` event. */
  history: unknown[]
  pending: PendingAsk | null
  message: string
  form: FormContext
}

/** Server-sent events streamed from POST /api/chat. */
export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'status'; text: string }
  | { type: 'question'; question: string; options: string[] }
  | { type: 'spec'; spec: QuerySpec; summary: string; autoRun: boolean }
  | { type: 'done'; history: unknown[]; pending: PendingAsk | null }
  | { type: 'error'; message: string }
