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
import { describe, expect, it } from 'vitest'

import { dotColorMap } from '@/components/status-badge'
import type {
  ModelRequestResult,
  ModelRequestStatus,
} from '@/features/dashboard/types'

import {
  buildGridCells,
  getModelStatusMeta,
  MODEL_STATUS_META,
  MODEL_STATUS_ORDER,
} from '../lib/status-map'

function makeResult(
  overrides: Partial<ModelRequestResult> & {
    status: ModelRequestStatus
    created_at: number
  }
): ModelRequestResult {
  return {
    channel_id: 1,
    channel_name: 'channel-a',
    error_category: '',
    error_code: '',
    content: '',
    ...overrides,
  }
}

describe('model status map', () => {
  it('maps every status to its label key and semantic dot color', () => {
    expect(MODEL_STATUS_META.success).toEqual({
      labelKey: 'Normal',
      dotClass: dotColorMap.success,
    })
    expect(MODEL_STATUS_META.rate_limit).toEqual({
      labelKey: 'Rate limit',
      dotClass: dotColorMap.warning,
    })
    expect(MODEL_STATUS_META.quota).toEqual({
      labelKey: 'Insufficient quota',
      dotClass: dotColorMap.purple,
    })
    expect(MODEL_STATUS_META.unavailable).toEqual({
      labelKey: 'Unavailable',
      dotClass: dotColorMap.danger,
    })
    expect(MODEL_STATUS_META.other_error).toEqual({
      labelKey: 'Other error',
      dotClass: dotColorMap.neutral,
    })
  })

  it('exposes the five statuses in legend order through getModelStatusMeta', () => {
    expect(MODEL_STATUS_ORDER).toEqual([
      'success',
      'rate_limit',
      'quota',
      'unavailable',
      'other_error',
    ])
    for (const status of MODEL_STATUS_ORDER) {
      expect(getModelStatusMeta(status)).toBe(MODEL_STATUS_META[status])
    }
  })

  it('keeps newest-first requests in chronological order with the newest on the right', () => {
    const cells = buildGridCells(
      [
        makeResult({ status: 'success', created_at: 300 }),
        makeResult({ status: 'rate_limit', created_at: 200 }),
        makeResult({ status: 'quota', created_at: 100 }),
      ],
      3
    )
    expect(cells.map((cell) => cell.result?.created_at)).toEqual([
      100, 200, 300,
    ])
    expect(cells.map((cell) => cell.result?.status)).toEqual([
      'quota',
      'rate_limit',
      'success',
    ])
  })

  it('pads short rows with no-data cells on the left so the newest stays rightmost', () => {
    const cells = buildGridCells(
      [
        makeResult({ status: 'success', created_at: 300 }),
        makeResult({ status: 'rate_limit', created_at: 200 }),
      ],
      5
    )
    expect(cells).toHaveLength(5)
    expect(cells.map((cell) => cell.result)).toEqual([
      null,
      null,
      null,
      expect.objectContaining({ status: 'rate_limit', created_at: 200 }),
      expect.objectContaining({ status: 'success', created_at: 300 }),
    ])
  })

  it('caps rows that exceed the limit to the newest requests', () => {
    const cells = buildGridCells(
      Array.from({ length: 6 }, (_, index) =>
        makeResult({ status: 'success', created_at: index + 1 })
      ).reverse(),
      4
    )
    expect(cells).toHaveLength(4)
    expect(cells.map((cell) => cell.result?.created_at)).toEqual([3, 4, 5, 6])
  })

  it('renders an all-empty row when there are no requests', () => {
    const cells = buildGridCells([], 3)
    expect(cells.map((cell) => cell.result)).toEqual([null, null, null])
    expect(cells.map((cell) => cell.id)).toEqual([
      'no-data-0',
      'no-data-1',
      'no-data-2',
    ])
  })

  it('does not mutate the input array', () => {
    const input = [
      makeResult({ status: 'success', created_at: 2 }),
      makeResult({ status: 'success', created_at: 1 }),
    ]
    buildGridCells(input, 2)
    expect(input.map((result) => result.created_at)).toEqual([2, 1])
  })
})
