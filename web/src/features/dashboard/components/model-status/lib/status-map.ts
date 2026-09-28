/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { dotColorMap } from '@/components/status-badge'
import type {
  ModelRequestResult,
  ModelRequestStatus,
} from '@/features/dashboard/types'

export interface ModelStatusMeta {
  /** i18n key for the status label */
  labelKey: string
  /** Semantic dot/background class for grid cells and legend markers */
  dotClass: string
}

/** Status → label key + semantic color mapping for the status grid. */
export const MODEL_STATUS_META: Record<ModelRequestStatus, ModelStatusMeta> = {
  success: { labelKey: 'Normal', dotClass: dotColorMap.success },
  rate_limit: { labelKey: 'Rate limit', dotClass: dotColorMap.warning },
  quota: { labelKey: 'Insufficient quota', dotClass: dotColorMap.purple },
  unavailable: { labelKey: 'Unavailable', dotClass: dotColorMap.danger },
  other_error: { labelKey: 'Other error', dotClass: dotColorMap.neutral },
}

/** Legend / iteration order for every supported status. */
export const MODEL_STATUS_ORDER: ModelRequestStatus[] = [
  'success',
  'rate_limit',
  'quota',
  'unavailable',
  'other_error',
]

export function getModelStatusMeta(
  status: ModelRequestStatus
): ModelStatusMeta {
  return MODEL_STATUS_META[status]
}

export interface GridCell {
  /** Stable per-row key derived from the cell position (React key). */
  id: string
  result: ModelRequestResult | null
}

/**
 * Build the cells for one model row.
 *
 * The API returns `requests` newest-first; the grid renders newest → oldest
 * (newest at the far left). Sparse rows are padded on the right with "no data"
 * cells so the newest request of every model stays in the leftmost column.
 */
export function buildGridCells(
  requests: ModelRequestResult[],
  limit: number
): GridCell[] {
  const recent = [...requests].slice(0, limit)
  const cells: GridCell[] = recent.map((result, index) => ({
    id: `request-${index}`,
    result,
  }))
  const missing = Math.max(0, limit - recent.length)
  for (let index = 0; index < missing; index++) {
    cells.push({ id: `no-data-${index}`, result: null })
  }
  return cells
}
