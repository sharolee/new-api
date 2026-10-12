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

import { ModelParameterSyncDialog } from '../components/dialogs/model-parameter-sync-dialog'

const sources = [
  { name: 'models.dev', description: 'MIT metadata', enabled: true },
  { name: 'litellm', description: 'Raw GitHub', enabled: false },
]

// The dialog footer renders its own "Close" button in addition to the X
// ("dialog-close") button the Dialog chrome adds. Disambiguate by data-slot.
function footerCloseButton() {
  const matches = screen.getAllByRole('button', { name: 'Close' })
  return matches.find(
    (button) => button.getAttribute('data-slot') !== 'dialog-close'
  ) as HTMLElement
}

describe('model parameter sync', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies selected sources after preview and reports per-source counts', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: sources },
    })
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: {
          dryRun: false,
          results: [
            {
              source: 'models.dev',
              success: true,
              created: 3,
              updated: 1,
              skipped: 2,
              aliases: 4,
              unmatched: 0,
            },
          ],
        },
      },
    })
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    render(
      <QueryClientProvider client={client}>
        <ModelParameterSyncDialog open onOpenChange={() => {}} />
      </QueryClientProvider>
    )
    const user = userEvent.setup()

    // Wait for the sources query to settle before interacting.
    await waitFor(() => expect(client.isFetching()).toBe(0))

    // litellm is disabled so it must not be selectable.
    expect(
      screen.queryByRole('checkbox', { name: 'Select source litellm' })
    ).not.toBeInTheDocument()
    await user.click(
      await screen.findByRole('checkbox', { name: 'Select source models.dev' })
    )
    expect(screen.getByText('1 source(s) selected')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByText('Sync results')
    expect(post).toHaveBeenCalledWith('/api/model_parameters/sync', {
      sources: ['models.dev'],
      dryRun: false,
    })
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Aliases')).toBeInTheDocument()

    client.clear()
  })

  it('keeps the dialog locked while a sync is running', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: sources },
    })
    vi.spyOn(api, 'post').mockImplementation(
      () => new Promise(() => {}) // never resolves while the test asserts
    )
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    render(
      <QueryClientProvider client={client}>
        <ModelParameterSyncDialog open onOpenChange={() => {}} />
      </QueryClientProvider>
    )
    const user = userEvent.setup()

    await waitFor(() => expect(client.isFetching()).toBe(0))

    await user.click(
      await screen.findByRole('checkbox', { name: 'Select source models.dev' })
    )

    await user.click(screen.getByRole('button', { name: 'Apply' }))

    // While the mutation is pending every action button is disabled so the
    // user cannot interrupt a running sync.
    expect(footerCloseButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Syncing...' })
    ).toBeDisabled()

    client.clear()
  })

  it('re-enables the dialog buttons and allows closing after a successful apply', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: sources },
    })
    vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: {
          dryRun: false,
          results: [
            {
              source: 'models.dev',
              success: true,
              created: 1,
              updated: 0,
              skipped: 0,
              aliases: 0,
              unmatched: 0,
            },
          ],
        },
      },
    })
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={client}>
        <ModelParameterSyncDialog open onOpenChange={onOpenChange} />
      </QueryClientProvider>
    )
    const user = userEvent.setup()

    await waitFor(() => expect(client.isFetching()).toBe(0))

    await user.click(
      await screen.findByRole('checkbox', { name: 'Select source models.dev' })
    )
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    // Wait for the mutation result to appear.
    await screen.findByText('Sync results')

    // After success the buttons must be interactive again.
    expect(footerCloseButton()).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()

    await user.click(footerCloseButton())
    expect(onOpenChange).toHaveBeenCalledWith(false)

    client.clear()
  })
})
