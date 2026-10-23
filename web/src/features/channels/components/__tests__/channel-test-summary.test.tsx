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
import { render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, test } from 'vitest'

import { channelSchema } from '../../types'
import { ChannelsDialogs } from '../channels-dialogs'
import { ChannelsProvider, useChannels } from '../channels-provider'

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

function summaryRegion() {
  return within(screen.getByRole('region', { name: /Last test summary/ }))
}

describe('channel test dialog last test summary', () => {
  test('shows relative test time and response speed when channel has test data', () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const channel = {
      ...baseChannel,
      test_time: nowSeconds - 120,
      response_time: 850,
    }

    renderDialog(channel)

    expect(
      screen.getByRole('dialog', { name: /Test Channel Connection/ })
    ).toBeInTheDocument()
    expect(summaryRegion().getByText('2m ago')).toBeInTheDocument()
    expect(summaryRegion().getByText('850ms')).toBeInTheDocument()
  })

  test('falls back to Never / Not tested when channel has no test data', () => {
    renderDialog(baseChannel)

    expect(
      screen.getByRole('dialog', { name: /Test Channel Connection/ })
    ).toBeInTheDocument()
    expect(summaryRegion().getByText('Never')).toBeInTheDocument()
    expect(summaryRegion().getByText('Not tested')).toBeInTheDocument()
  })

  test('formats response time in seconds when value is 1000ms or more', () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const channel = {
      ...baseChannel,
      test_time: nowSeconds - 3600,
      response_time: 1500,
    }

    renderDialog(channel)

    expect(summaryRegion().getByText('1h ago')).toBeInTheDocument()
    expect(summaryRegion().getByText('1.50s')).toBeInTheDocument()
  })
})
