import { randomUUID } from 'node:crypto'
import { AdzunaError } from '../../shared/adzunaErrors.js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleAdzunaSearch } from '../_lib/handlers.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json(new AdzunaError('invalid_filters', 405, randomUUID()).envelope())
  }

  const result = await handleAdzunaSearch(req.body, process.env)
  return res.status(result.status).json(result.body)
}
