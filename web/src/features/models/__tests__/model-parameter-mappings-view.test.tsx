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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ModelMappingsView } from '../components/model-parameter-mappings-view'
import type { ModelMappingRow } from '../types'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  getRouteApi: () => ({
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
}))

const base: Omit<ModelMappingRow, 'model' | 'declaredModel' | 'matched'> = {
  channelId: 1,
  channelName: 'OpenAI Channel',
  channelType: 1,
  canonicalId: null,
  canonicalKey: null,
  displayName: null,
  origin: null,
  confidence: null,
}

function mapRows(
  rows: Array<
    Pick<ModelMappingRow, 'model' | 'declaredModel' | 'matched'> &
      Partial<ModelMappingRow>
  >
): ModelMappingRow[] {
  return rows.map((row) => ({ ...base, ...row }))
}

describe('model parameter mappings view', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the declared local name as a secondary line when it differs from the upstream model', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          items: mapRows([
            { model: 'gpt-5', declaredModel: 'freespeed', matched: true },
          ]),
          total: 1,
        },
      },
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <ModelMappingsView />
      </QueryClientProvider>
    )

    // Primary cell is the upstream model name.
    await screen.findByText('gpt-5')
    // Declared (local) name renders as a secondary provenance line.
    await screen.findByText('freespeed')
    expect(screen.getByText('freespeed')).not.toBe(screen.getByText('gpt-5'))

    client.clear()
  })

  it('does not render a secondary line when the declared name equals the upstream model', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          items: mapRows([
            { model: 'gpt-5', declaredModel: 'gpt-5', matched: true },
          ]),
          total: 1,
        },
      },
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <ModelMappingsView />
      </QueryClientProvider>
    )

    // The model name appears exactly once: no duplicated secondary line.
    await screen.findByText('gpt-5')
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.getAllByText('gpt-5')).toHaveLength(1)

    client.clear()
  })
})
