import { existsSync } from 'node:fs'

// Load .env if present (Node built-in; no dotenv dependency).
if (existsSync('.env')) process.loadEnvFile('.env')

const env = (key: string) => process.env[key]?.trim() || undefined

export const config = {
  port: Number(env('PORT') ?? 3001),
  anthropicApiKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5',
  socrataKeyId: env('SOCRATA_API_KEY'),
  socrataKeySecret: env('SOCRATA_API_SECRET'),
  aiAutoRun: env('AI_AUTO_RUN')?.toLowerCase() === 'true',
  /** Small model that classifies a dataset's columns once (cached on disk). */
  classifyModel: env('ANTHROPIC_CLASSIFY_MODEL') ?? 'claude-haiku-5-5',
  aiClassifyColumns: env('AI_CLASSIFY_COLUMNS')?.toLowerCase() !== 'false',
  socrataDomain: 'data.wa.gov',
}

export const aiEnabled = () => Boolean(config.anthropicApiKey)
