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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ModelParameterOverviewView } from '../components/model-parameter-overview-view'
import type { ModelOverviewRow } from '../types'

const stableSearch: Record<string, unknown> = {}

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  getRouteApi: () => ({
    useSearch: () => stableSearch,
    useNavigate: () => vi.fn(),
  }),
}))

const matchedRow: ModelOverviewRow = {
  model: 'gpt-5',
  declaredModels: ['freespeed'],
  matched: true,
  canonicalId: 10,
  canonicalKey: 'openai/gpt-5',
  displayName: 'GPT-5',
  contextLength: 100000,
  maxOutputTokens: 32768,
  capabilities: ['reasoning', 'vision'],
  origin: 'auto',
  confidence: 0.9,
}

const unmatchedRow: ModelOverviewRow = {
  model: 'mystery-model',
  declaredModels: ['mystery-local'],
  matched: false,
  canonicalId: null,
  canonicalKey: null,
  displayName: '',
  contextLength: 98765,
  maxOutputTokens: 4321,
  capabilities: [],
  origin: null,
  confidence: null,
}

function renderView(items: ModelOverviewRow[], total = items.length) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { items, total },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ModelParameterOverviewView />
    </QueryClientProvider>
  )
  return client
}

describe('model parameter overview view', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a matched row with context/output values and capability tags', async () => {
    const client = renderView([matchedRow])

    await screen.findByText('gpt-5')
    expect(screen.getByText('freespeed')).toBeInTheDocument()
    expect(screen.getByText('100000')).toBeInTheDocument()
    expect(screen.getByText('32768')).toBeInTheDocument()
    expect(screen.getByText('Reasoning')).toBeInTheDocument()
    expect(screen.getByText('Vision')).toBeInTheDocument()

    client.clear()
  })

  it('renders an unmatched row with a placeholder instead of numbers', async () => {
    const client = renderView([unmatchedRow])

    await screen.findByText('mystery-model')
    // The numeric values must not leak into the context / max output cells.
    expect(screen.queryByText('98765')).not.toBeInTheDocument()
    expect(screen.queryByText('4321')).not.toBeInTheDocument()
    // Placeholder appears in the status column plus both param columns.
    expect(screen.getAllByText('Unmatched')).toHaveLength(3)

    client.clear()
  })

  it('refetches with the keyword param when the search input is used', async () => {
    const client = renderView([matchedRow, unmatchedRow])
    const user = userEvent.setup()

    await screen.findByText('gpt-5')
    const input = screen.getByPlaceholderText('Filter by model name...')
    await user.type(input, 'gpt')

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/api/model_parameters/overview',
        expect.objectContaining({
          params: expect.objectContaining({ keyword: 'gpt' }),
        })
      )
    )

    client.clear()
  })

  it('refetches with the capability param when the capability filter is selected', async () => {
    // Vision-only row so "Reasoning" exists only inside the filter popover.
    const visionRow: ModelOverviewRow = {
      ...matchedRow,
      capabilities: ['vision'],
    }
    const client = renderView([visionRow])
    const user = userEvent.setup()

    await screen.findByText('gpt-5')
    await user.click(screen.getByRole('button', { name: 'Capability' }))
    await user.click(await screen.findByText('Reasoning'))

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/api/model_parameters/overview',
        expect.objectContaining({
          params: expect.objectContaining({ capability: 'reasoning' }),
        })
      )
    )

    client.clear()
  })

  it('refetches with sort/order params when a sortable column header is clicked', async () => {
    const client = renderView([matchedRow])
    const user = userEvent.setup()

    await screen.findByText('gpt-5')
    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(await screen.findByText('Desc'))

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/api/model_parameters/overview',
        expect.objectContaining({
          params: expect.objectContaining({ sort: 'name', order: 'desc' }),
        })
      )
    )

    client.clear()
  })

  it('renders the empty state when no rows are returned', async () => {
    const client = renderView([], 0)

    await screen.findByText('No models found')

    client.clear()
  })

  it('renders a matched row with a placeholder when capabilities is null', async () => {
    // Regression: the API once emitted "capabilities": null for matched rows
    // with no capabilities, crashing the cell on .length. Defensive fallback
    // must render the placeholder instead of throwing.
    const nullCapabilitiesRow: ModelOverviewRow = {
      ...matchedRow,
      capabilities: null as unknown as string[],
    }
    const client = renderView([nullCapabilitiesRow])

    await screen.findByText('gpt-5')
    // Status col shows Matched (header also carries Matched); the capabilities
    // cell must show the em dash placeholder instead of crashing.
    expect(screen.getAllByText('Matched').length).toBeGreaterThan(0)
    expect(screen.getByText('—')).toBeInTheDocument()

    client.clear()
  })
})
