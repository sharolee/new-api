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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { ErrorAnalysisStats } from '../../types'
import { buildErrorChartSpecs, type ErrorChartSpec } from '../error-charts'
import { formatChartTime } from '../../../../lib/time'

const t = (key: string) => key

const stats: ErrorAnalysisStats = {
  total: 2,
  by_channel: { '1': 2 },
  by_error: { '404': 1, '429': 1 },
  by_date: [
    {
      date: '1710000000',
      total: 1,
      by_error: { '404': 1 },
      by_channel: { '1': 1 },
    },
    {
      date: '1710003600',
      total: 1,
      by_error: { '429': 1 },
      by_channel: { '1': 1 },
    },
  ],
  detail: [
    {
      channel_id: 1,
      channel_name: 'openai',
      error_code: '404',
      count: 1,
    },
  ],
}

function assertVChartBarOrArea(spec: ErrorChartSpec) {
  assert.ok(spec.xField, 'spec must use VChart xField')
  assert.ok(spec.yField, 'spec must use VChart yField')
  assert.equal('encode' in spec, false)
  assert.equal('dataField' in spec, false)
  assert.equal('categoryField' in spec, false)
  assert.ok(Array.isArray(spec.data), 'spec.data must be [{ id, values }]')
  assert.equal(typeof spec.data[0]?.id, 'string')
  assert.ok(Array.isArray(spec.data[0]?.values))
}

describe('buildErrorChartSpecs', () => {
  test('builds VChart bar and area specs from error stats so charts have values', () => {
    const specs = buildErrorChartSpecs(stats, t, 'hour')

    assertVChartBarOrArea(specs.spec_channel_bar)
    assert.equal(specs.spec_channel_bar.type, 'bar')
    assert.equal(specs.spec_channel_bar.xField, 'Channel')
    assert.equal(specs.spec_channel_bar.yField, 'Count')
    assert.deepEqual(specs.spec_channel_bar.data[0].values, [
      { Channel: 'openai', Count: 2 },
    ])

    assertVChartBarOrArea(specs.spec_error_bar)
    assert.equal(specs.spec_error_bar.type, 'bar')
    assert.equal(specs.spec_error_bar.xField, 'Error')
    assert.equal(specs.spec_error_bar.yField, 'Count')
    assert.deepEqual(specs.spec_error_bar.data[0].values, [
      { Error: '404', Count: 1, Code: '404' },
      { Error: '429', Count: 1, Code: '429' },
    ])

    assertVChartBarOrArea(specs.spec_trend_line)
    assert.equal(specs.spec_trend_line.type, 'area')
    assert.equal(specs.spec_trend_line.xField, 'Time')
    assert.equal(specs.spec_trend_line.yField, 'Count')
    assert.deepEqual(specs.spec_trend_line.data[0].values, [
      { Time: formatChartTime(1710000000, 'hour'), Count: 1 },
      { Time: formatChartTime(1710003600, 'hour'), Count: 1 },
    ])
  })

  test('falls back to channel id when detail has no name', () => {
    const specs = buildErrorChartSpecs(
      {
        ...stats,
        detail: [],
        by_channel: { '42': 2 },
      },
      t,
      'hour'
    )

    assert.deepEqual(specs.spec_channel_bar.data[0].values, [
      { Channel: '#42', Count: 2 },
    ])
  })

  test('labels error bars by translated category and keeps original codes on the row', () => {
    const labels: Record<string, string> = {
      'Rate limit': '速率限制',
      'Not found': '未找到',
      Quota: '额度不足',
    }
    const translate = (key: string) => labels[key] ?? key
    const specs = buildErrorChartSpecs(
      {
        total: 4,
        by_channel: { '1': 4 },
        by_error: { rate_limit: 2, not_found: 1, quota: 1 },
        by_date: [],
        detail: [
          {
            channel_id: 1,
            channel_name: 'openai',
            error_code: 'rate_limit',
            count: 2,
          },
        ],
      },
      translate,
      'hour'
    )

    assert.deepEqual(specs.spec_error_bar.data[0].values, [
      { Error: '速率限制', Count: 2, Code: 'rate_limit' },
      { Error: '未找到', Count: 1, Code: 'not_found' },
      { Error: '额度不足', Count: 1, Code: 'quota' },
    ])
  })

  test('returns valid empty-value specs when there are no errors', () => {
    const specs = buildErrorChartSpecs(
      {
        total: 0,
        by_channel: {},
        by_error: {},
        by_date: [],
        detail: [],
      },
      t,
      'day'
    )

    assertVChartBarOrArea(specs.spec_channel_bar)
    assertVChartBarOrArea(specs.spec_error_bar)
    assertVChartBarOrArea(specs.spec_trend_line)
    assert.deepEqual(specs.spec_channel_bar.data[0].values, [])
    assert.deepEqual(specs.spec_error_bar.data[0].values, [])
    assert.deepEqual(specs.spec_trend_line.data[0].values, [])
  })
})
