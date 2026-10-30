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
import { render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getChannelTestResults } from '../../api'
import { channelSchema } from '../../types'
import { ChannelsDialogs } from '../channels-dialogs'
import { ChannelsProvider, useChannels } from '../channels-provider'

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return {
    ...actual,
    getChannelTestResults: vi.fn(async () => []),
  }
})

function TestHarness({
  channel,
}: {
  channel: ReturnType<typeof channelSchema.parse>
}) {
  const { setCurrentRow, setOpen } = useChannels()

  useEffect(() => {
    setCurrentRow(channel)
    setOpen('test-channel')
  }, [channel, setCurrentRow, setOpen])

  return <ChannelsDialogs />
}

function renderDialog(channel: ReturnType<typeof channelSchema.parse>) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ChannelsProvider>
        <TestHarness channel={channel} />
      </ChannelsProvider>
    </QueryClientProvider>
  )
}

const baseChannel = channelSchema.parse({
  id: 42,
  type: 1,
  key: 'sk-test',
  name: 'Test Channel',
  status: 1,
  created_time: 1,
  test_time: 0,
  response_time: 0,
  balance_updated_time: 0,
  models: 'gpt-4o',
})

describe('channel test dialog per-model last tested column', () => {
  beforeEach(() => {
    vi.mocked(getChannelTestResults).mockResolvedValue([])
  })

  test('shows Last Tested column header in the model table', () => {
    renderDialog(baseChannel)

    const table = screen.getByRole('region', { name: /Channel models/ })
    expect(
      within(table).getByRole('columnheader', { name: /Last Tested/ })
    ).toBeInTheDocument()
  })

  test('shows Never for models that have not been tested', () => {
    renderDialog(baseChannel)

    const table = screen.getByRole('region', { name: /Channel models/ })
    // The model row for gpt-4o should show "Never" in the Last Tested column
    const rows = within(table).getAllByRole('row')
    // Find the data row (not header) containing the model name
    const modelRow = rows.find((row) =>
      within(row).queryByText('gpt-4o')
    )
    expect(modelRow).toBeDefined()
    expect(within(modelRow as HTMLElement).getByText('Never')).toBeInTheDocument()
  })

  test('does not show channel-level last test summary section', () => {
    renderDialog(baseChannel)

    // The old "Last test summary" region should no longer exist
    expect(
      screen.queryByRole('region', { name: /Last test summary/ })
    ).not.toBeInTheDocument()
  })

  test('restores the last successful test time of a model from the backend', async () => {
    const testedAt = Math.floor(Date.now() / 1000) - 60
    vi.mocked(getChannelTestResults).mockResolvedValue([
      { model_name: 'gpt-4o', tested_at: testedAt },
    ])

    renderDialog(baseChannel)

    const table = screen.getByRole('region', { name: /Channel models/ })
    const modelRow = within(table)
      .getAllByRole('row')
      .find((row) => within(row).queryByText('gpt-4o')) as HTMLElement

    await waitFor(() => {
      expect(within(modelRow).queryByText('Never')).not.toBeInTheDocument()
    })
    expect(getChannelTestResults).toHaveBeenCalledWith(baseChannel.id)
  })
})
