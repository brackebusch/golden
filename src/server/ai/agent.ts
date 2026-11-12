import Anthropic from '@anthropic-ai/sdk'
import type { ChatEvent, ChatRequest, FormContext, PendingAsk } from '@shared/chat'
import { config } from '../config'
import { getClient } from './client'
import { SYSTEM_PROMPT } from './prompt'
import { isToolName, parseToolInput, runTool, toolStatus, TOOLS } from './tools'

type MessageParam = Anthropic.Beta.BetaMessageParam
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam

/** Safety cap on model calls per user message. */
const MAX_STEPS = 10
/** Models that support server-side refusal fallback with the "default" routing. */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])



function formContextText(form: FormContext): string {
  const state = form.spec
    ? JSON.stringify(form.spec)
    : form.incompatibleReason
      ? `blocked: ${form.incompatibleReason}`
      : 'empty'
  return `<form_state>\nDataset: ${form.datasetName ?? 'none'} (${form.datasetId ?? 'none'})\nChart type: ${form.chartType}\nCurrent spec: ${state}\n</form_state>`
}

/** Run one user turn of the agent loop, streaming events to the client. */
export async function runChat(req: ChatRequest, emit: (e: ChatEvent) => void, signal: AbortSignal) {
  const messages = [...(req.history as MessageParam[])]

  // The user's message: either the answer to a pending ask_user, or a new message.
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  if (req.pending) {
    content.push(...(req.pending.otherResults as ToolResult[]))
    content.push({ type: 'tool_result', tool_use_id: req.pending.toolUseId, content: req.message })
    content.push({ type: 'text', text: formContextText(req.form) })
  } else {
    content.push({ type: 'text', text: formContextText(req.form) })
    content.push({ type: 'text', text: req.message })
  }
  messages.push({ role: 'user', content })

  const fallback = FALLBACK_MODELS.has(config.anthropicModel)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
    : {}

  let pending: PendingAsk | null = null
  let jsonRetries = 0

  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = getClient().beta.messages.stream(
      {
        model: config.anthropicModel,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
        output_config: { effort: 'medium' },
        tools: TOOLS,
        messages,
        ...fallback,
      },
      { signal },
    )
    stream.on('text', (delta) => emit({ type: 'text', delta }))

    let message: Anthropic.Beta.BetaMessage
    try {
      message = await stream.finalMessage()
      jsonRetries = 0
    } catch (err) {
      // Only an unparseable streamed tool input is retried; API errors propagate.
      if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err
      continue
    }

    const u = message.usage
    console.log(
      `[chat] ${message.model} step ${step + 1}: ${u.input_tokens} in (+${u.cache_read_input_tokens ?? 0} cached, ${u.cache_creation_input_tokens ?? 0} written), ${u.output_tokens} out, stop=${message.stop_reason}`,
    )

    if (message.stop_reason === 'refusal') {
      emit({ type: 'error', message: "Claude declined to answer that. Try rephrasing the question." })
      messages.push({ role: 'assistant', content: message.content })
      break
    }
    messages.push({ role: 'assistant', content: message.content })

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) break
    if (message.stop_reason === 'max_tokens') {
      emit({ type: 'error', message: 'The response was cut off. Try a more specific question.' })
      break
    }

    const results: ToolResult[] = []
    let ask: { id: string; question: string; options: string[] } | null = null

    for (const tool of toolUses) {
      if (!isToolName(tool.name)) {
        results.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: `Unknown tool ${tool.name}` })
        continue
      }
      const parsed = parseToolInput(tool.name, tool.input)
      if (!parsed.success) {
        results.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          is_error: true,
          content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        })
        continue
      }
      if (tool.name === 'ask_user') {
        const { question, options } = parsed.data as { question: string; options: string[] }
        ask = { id: tool.id, question, options }
        continue
      }
      emit({ type: 'status', text: toolStatus(tool.name, tool.input as Record<string, unknown>) })
      try {
        const r = await runTool(tool.name, tool.input, {
          onSpec: (spec, summary) => emit({ type: 'spec', spec, summary, autoRun: config.aiAutoRun }),
        })
        results.push({ type: 'tool_result', tool_use_id: tool.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: e instanceof Error ? e.message : String(e) })
      }
    }

    if (ask) {
      // End the turn; the user's answer becomes this tool's result on the next request.
      emit({ type: 'question', question: ask.question, options: ask.options })
      pending = { toolUseId: ask.id, otherResults: results }
      break
    }
    messages.push({ role: 'user', content: results })
  }

  emit({ type: 'done', history: messages, pending })
}

/** Turn an API error into a message the user can act on. */
export function chatErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.'
  if (err instanceof Anthropic.RateLimitError) return 'Claude is rate limited right now. Wait a moment and try again.'
  if (err instanceof Anthropic.BadRequestError) return `Claude API rejected the request: ${err.message}`
  if (err instanceof Anthropic.APIError) return `Claude API error (${err.status ?? 'network'}): ${err.message}`
  return err instanceof Error ? err.message : String(err)
}
