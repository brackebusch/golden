import express, { type NextFunction, type Request, type Response } from 'express'
import { querySpecSchema } from '@shared/querySpec'
import { validateSpec } from '@shared/charts'
import { aiEnabled, config } from './config'
import { searchDatasets, warmCatalog } from './soda/catalog'
import { getProfile } from './soda/profile'
import { distinctValues, runQuery } from './soda/compile'
import { SodaError } from './soda/http'
import { chatErrorMessage, runChat } from './ai/agent'
import type { ChatEvent, ChatRequest } from '@shared/chat'

const app = express()
app.use(express.json({ limit: '1mb' }))

const DATASET_ID = /^[a-z0-9]{4}-[a-z0-9]{4}$/

app.get('/api/config', (_req, res) => {
  res.json({ aiEnabled: aiEnabled(), aiAutoRun: config.aiAutoRun })
})

app.get('/api/datasets', async (req, res) => {
  res.json(await searchDatasets(String(req.query.q ?? '')))
})

app.get('/api/datasets/:id/profile', async (req, res) => {
  if (!DATASET_ID.test(req.params.id)) return void res.status(400).json({ error: 'Invalid dataset id' })
  res.json(await getProfile(req.params.id))
})

app.get('/api/datasets/:id/values', async (req, res) => {
  if (!DATASET_ID.test(req.params.id)) return void res.status(400).json({ error: 'Invalid dataset id' })
  const profile = await getProfile(req.params.id)
  res.json(await distinctValues(profile, String(req.query.column ?? ''), String(req.query.q ?? '')))
})

app.post('/api/query', async (req, res) => {
  const parsed = querySpecSchema.safeParse(req.body)
  if (!parsed.success) return void res.status(400).json({ error: 'Invalid query', details: parsed.error.issues })
  const profile = await getProfile(parsed.data.datasetId)
  const errors = validateSpec(profile, parsed.data)
  if (errors.length) return void res.status(400).json({ error: errors.join(' ') })
  res.json(await runQuery(profile, parsed.data))
})

app.post('/api/chat', async (req, res) => {
  if (!aiEnabled()) return void res.status(503).json({ error: 'Chat is disabled: set ANTHROPIC_API_KEY in .env.' })
  const body = req.body as ChatRequest
  if (typeof body?.message !== 'string' || !body.message.trim() || !Array.isArray(body.history))
    return void res.status(400).json({ error: 'Invalid chat request' })

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const emit = (e: ChatEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`)
  const abort = new AbortController()
  res.on('close', () => abort.abort())
  try {
    await runChat(body, emit, abort.signal)
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error('[chat]', err)
      emit({ type: 'error', message: chatErrorMessage(err) })
    }
  }
  res.end()
})

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof SodaError ? ([429, 504].includes(err.status) ? err.status : 502) : 500
  const message = err instanceof Error ? err.message : 'Unexpected error'
  if (status === 500) console.error(err)
  res.status(status).json({ error: message })
})

app.listen(config.port, (err?: Error) => {
  if (err) {
    console.error(`Could not start the API server on port ${config.port}: ${err.message}`)
    console.error('Is another copy of the app already running? Stop it, or set PORT in .env.')
    process.exit(1)
  }
  console.log(`API server on http://localhost:${config.port}`)
  warmCatalog()
  console.log(`  AI chat: ${aiEnabled() ? `enabled (${config.anthropicModel})` : 'disabled (no ANTHROPIC_API_KEY)'}`)
  console.log(`  Socrata API key: ${config.socrataKeyId && config.socrataKeySecret ? 'set' : 'not set (anonymous)'}`)
})
