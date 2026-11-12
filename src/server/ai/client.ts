import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config'

let client: Anthropic | null = null
/** Shared Anthropic client (created on first use, so the server starts without a key). */
export const getClient = () => (client ??= new Anthropic({ apiKey: config.anthropicApiKey }))
