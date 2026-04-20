import { initDb } from '@/lib/db-init'
import {
  getDimensionalEmotionConfig,
  updateDimensionalEmotionConfig,
} from './handler'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params

  return getDimensionalEmotionConfig(id)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json()

  return updateDimensionalEmotionConfig(id, body)
}
