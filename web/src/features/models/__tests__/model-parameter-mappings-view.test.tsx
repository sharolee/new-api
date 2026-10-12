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

import { ModelMappingsView } from '../components/model-parameter-mappings-view'
import type { ModelMappingRow } from '../types'

// The mocked route API must return stable `useSearch`/`useNavigate` references.
// Returning a fresh object/function on every render drives the table's
// search-sync effect into an infinite update loop once the view re-renders (for
// example when the assign dialog opens), which blocks the event loop and hangs
// the test.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const search = {}
  const navigate = vi.fn()
  return {
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    getRouteApi: () => ({
      useSearch: () => search,
      useNavigate: () => navigate,
    }),
  }
})

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

  it('pre-selects the row existing canonical mapping when opening the assign dialog', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/model_parameters/mappings') {
        return {
          data: {
            success: true,
            data: {
              items: mapRows([
                {
                  model: 'moonshot-v1',
                  declaredModel: 'moonshot-v1',
                  matched: true,
                  canonicalId: 977,
                  canonicalKey: 'kimi-k2-6',
                  displayName: 'Kimi k2.6',
                },
              ]),
              total: 1,
            },
          },
        }
      }
      return { data: { success: true, data: { items: [], total: 0 } } }
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <ModelMappingsView />
      </QueryClientProvider>
    )

    const assignButton = await screen.findByRole('button', { name: 'Assign' })
    await user.click(assignButton)

    // The current mapping is shown as the selected value, so opening another row
    // can never inherit a stale selection from a previous dialog.
    const input = screen.getByRole('combobox', { name: 'Canonical model' })
    await waitFor(() => expect(input).toHaveValue('kimi-k2-6'))

    client.clear()
  })

  it('searches canonical models by keyword on the server when assigning', async () => {
    const user = userEvent.setup()
    const get = vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
      if (url === '/api/model_parameters/mappings') {
        return {
          data: {
            success: true,
            data: {
              items: mapRows([
                {
                  model: 'moonshot-v1',
                  declaredModel: 'moonshot-v1',
                  matched: false,
                },
              ]),
              total: 1,
            },
          },
        }
      }
      if (url === '/api/model_parameters') {
        const keyword = config?.params?.keyword
        return {
          data: {
            success: true,
            data: keyword
              ? {
                  items: [
                    {
                      id: 977,
                      canonicalKey: 'kimi-k2-6',
                      displayName: 'Kimi k2.6',
                    },
                  ],
                  total: 1,
                }
              : { items: [], total: 0 },
          },
        }
      }
      return { data: { success: true, data: { items: [], total: 0 } } }
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <ModelMappingsView />
      </QueryClientProvider>
    )

    // Open the assign dialog for an unmatched row.
    const assignButton = await screen.findByRole('button', { name: 'Assign' })
    await user.click(assignButton)
    const input = screen.getByRole('combobox', { name: 'Canonical model' })

    // Opening the dialog fetches the first page of candidates.
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/api/model_parameters',
        expect.objectContaining({
          params: expect.objectContaining({ page_size: 50 }),
        })
      )
    )

    // Typing defers to a server-side keyword search.
    await user.click(input)
    await user.type(input, 'kimi')
    await waitFor(
      () =>
        expect(get).toHaveBeenCalledWith(
          '/api/model_parameters',
          expect.objectContaining({
            params: expect.objectContaining({ keyword: 'kimi' }),
          })
        ),
      { timeout: 2000 }
    )

    // The server-side match renders as a selectable option.
    expect(await screen.findByRole('option', { name: /kimi-k2-6/ })).toBeVisible()

    client.clear()
  })
})
