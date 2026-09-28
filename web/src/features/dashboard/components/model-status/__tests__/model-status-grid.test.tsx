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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelRequestRow } from '@/features/dashboard/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { ModelStatusGrid } from '../model-status-grid'

const fixtureRows: ModelRequestRow[] = [
  {
    model: 'gpt-4o',
    total: 3,
    requests: [
      {
        status: 'success',
        created_at: 1_760_000_100,
        channel_id: 3,
        channel_name: 'OpenAI Main',
        error_category: '',
        error_code: '',
        content: '',
      },
      {
        status: 'rate_limit',
        created_at: 1_760_000_000,
        channel_id: 3,
        channel_name: 'OpenAI Main',
        error_category: 'RateLimitError',
        error_code: '429',
        content: 'Rate limit reached for model',
      },
      {
        status: 'unavailable',
        created_at: 1_759_999_900,
        channel_id: 5,
        channel_name: 'Anthropic US',
        error_category: 'ConnectionError',
        error_code: 'ECONNREFUSED',
        content: 'upstream unavailable',
      },
    ],
  },
  {
    model: 'claude-3-5-sonnet',
    total: 2,
    requests: [
      {
        status: 'quota',
        created_at: 1_760_000_200,
        channel_id: 5,
        channel_name: 'Anthropic US',
        error_category: 'QuotaError',
        error_code: 'insufficient_quota',
        content: '',
      },
      {
        status: 'other_error',
        created_at: 1_759_999_800,
        channel_id: 5,
        channel_name: 'Anthropic US',
        error_category: '',
        error_code: '500',
        content: 'internal error',
      },
    ],
  },
]

let client: QueryClient
let apiGetMock: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  window.localStorage.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'grid-user',
    role: 10,
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  apiGetMock = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (
      url === '/api/data/model-status' ||
      url === '/api/data/model-status/self'
    ) {
      return { data: { success: true, data: fixtureRows } }
    }
    throw new Error(`Unexpected dashboard request: ${url}`)
  })
})

afterEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  window.localStorage.clear()
})

function renderGrid() {
  return render(
    <QueryClientProvider client={client}>
      <ModelStatusGrid />
    </QueryClientProvider>
  )
}

describe('ModelStatusGrid', () => {
  it('renders one row per model with status cells and the legend after loading', async () => {
    renderGrid()

    expect(await screen.findByText('gpt-4o')).toBeVisible()
    expect(screen.getByText('claude-3-5-sonnet')).toBeVisible()
    expect(screen.getByText('Recent requests')).toBeVisible()
    for (const label of [
      'Normal',
      'Rate limit',
      'Insufficient quota',
      'Unavailable',
      'Other error',
    ]) {
      expect(screen.getByText(label)).toBeVisible()
    }

    const gptRow = screen
      .getByText('gpt-4o')
      .closest('[data-slot="model-status-row"]')
    expect(gptRow).not.toBeNull()
    const gptStatuses = Array.from(
      gptRow?.querySelectorAll('[data-status]') ?? [],
      (cell) => cell.getAttribute('data-status')
    )
    // Default limit 20: 3 requests newest → oldest, then 17 no-data pads.
    expect(gptStatuses).toHaveLength(20)
    expect(gptStatuses.slice(0, 3)).toEqual([
      'success',
      'rate_limit',
      'unavailable',
    ])
  })

  it('labels every cell accessibly and leaves sparse rows with no-data cells', async () => {
    renderGrid()

    await screen.findByText('gpt-4o')
    expect(screen.getByLabelText(/^gpt-4o Normal /)).toBeInTheDocument()
    expect(screen.getByLabelText(/^gpt-4o Unavailable /)).toBeInTheDocument()
    // claude-3-5-sonnet has 2 requests → 18 no-data cells.
    const emptyCells = screen.getAllByLabelText('claude-3-5-sonnet No data')
    expect(emptyCells).toHaveLength(18)
    expect(emptyCells[0]).toHaveClass('border-border/60', 'bg-transparent')
  })

  it('shows the empty state when the API returns no rows', async () => {
    apiGetMock.mockImplementation(async () => ({
      data: { success: true, data: [] },
    }))
    renderGrid()

    expect(
      await screen.findByText('No request data for the selected range')
    ).toBeVisible()
    expect(
      screen.getByText(
        'Adjust the time range or limit to see request status dots.'
      )
    ).toBeVisible()
  })

  it('shows a skeleton while the request is pending and replaces it with rows', async () => {
    let resolvePending!: (value: {
      data: { success: boolean; data: ModelRequestRow[] }
    }) => void
    const pending = new Promise<{
      data: { success: boolean; data: ModelRequestRow[] }
    }>((resolve) => {
      resolvePending = resolve
    })
    apiGetMock.mockReturnValueOnce(pending)
    renderGrid()

    expect(
      document.querySelector('[data-slot="model-status-grid-skeleton"]')
    ).not.toBeNull()

    await act(async () => {
      resolvePending({ data: { success: true, data: fixtureRows } })
    })
    expect(await screen.findByText('gpt-4o')).toBeVisible()
    expect(
      document.querySelector('[data-slot="model-status-grid-skeleton"]')
    ).toBeNull()
  })

  it('uses the admin endpoint for admins and the self endpoint for regular users', async () => {
    const first = renderGrid()
    await screen.findByText('gpt-4o')
    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/data/model-status',
      expect.objectContaining({
        params: expect.objectContaining({
          aggregate_by: 'upstream_model_name',
          limit: 20,
        }),
      })
    )

    // Unmount and clear the query cache so the role change triggers a fresh request.
    first.unmount()
    client.clear()
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'grid-user',
      role: 1,
    })
    renderGrid()
    expect(await screen.findByText('gpt-4o')).toBeVisible()
    expect(apiGetMock.mock.calls.at(-1)?.[0]).toBe(
      '/api/data/model-status/self'
    )
  })

  it('re-queries with the selected aggregate dimension and time range', async () => {
    const user = userEvent.setup()
    renderGrid()
    await screen.findByText('gpt-4o')

    await user.click(screen.getByRole('button', { name: 'By request model' }))
    await waitFor(() =>
      expect(apiGetMock).toHaveBeenCalledWith(
        expect.stringContaining('model-status'),
        expect.objectContaining({
          params: expect.objectContaining({ aggregate_by: 'model_name' }),
        })
      )
    )

    await user.click(screen.getByRole('button', { name: 'Last hour' }))
    await waitFor(() => {
      const lastCall = apiGetMock.mock.calls.at(-1)
      const params = lastCall?.[1]?.params as {
        start_timestamp: number
        end_timestamp: number
      }
      const now = Math.floor(Date.now() / 1000)
      expect(params.start_timestamp).toBeGreaterThanOrEqual(now - 3600 - 10)
      expect(params.start_timestamp).toBeLessThanOrEqual(now - 3600 + 10)
      expect(params.end_timestamp).toBeGreaterThanOrEqual(now - 10)
    })
  })

  it('changes the per-model cell limit through the select', async () => {
    const user = userEvent.setup()
    renderGrid()
    await screen.findByText('gpt-4o')

    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveTextContent('20')

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: '50' }))
    await waitFor(() =>
      expect(apiGetMock).toHaveBeenCalledWith(
        expect.stringContaining('model-status'),
        expect.objectContaining({
          params: expect.objectContaining({ limit: 50 }),
        })
      )
    )
    await waitFor(() => expect(trigger).toHaveTextContent('50'))
  })

  it('reveals request details in a tooltip when hovering a status cell', async () => {
    const user = userEvent.setup()
    renderGrid()
    await screen.findByText('gpt-4o')

    const rateLimitCell = screen.getByLabelText(/^gpt-4o Rate limit /)
    await user.hover(rateLimitCell)
    expect(await screen.findByText('RateLimitError 429')).toBeVisible()
    expect(screen.getByText('Channel: OpenAI Main')).toBeVisible()
    expect(screen.getByText('Rate limit reached for model')).toBeVisible()

    await user.unhover(rateLimitCell)
    await waitFor(() =>
      expect(screen.queryByText('RateLimitError 429')).not.toBeInTheDocument()
    )
  })

  it('explains empty cells with a no-data tooltip', async () => {
    const user = userEvent.setup()
    renderGrid()
    await screen.findByText('gpt-4o')

    const emptyCell = screen.getAllByLabelText('gpt-4o No data')[0]
    await user.hover(emptyCell)
    expect(await screen.findByText('No data')).toBeVisible()
  })
})
