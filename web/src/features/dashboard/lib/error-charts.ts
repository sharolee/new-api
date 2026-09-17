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
import { formatChartTime, type TimeGranularity } from '@/lib/time'

import type { ErrorAnalysisStats } from '@/features/dashboard/types'

import { getDashboardChartColors } from './charts'

type TFunction = (key: string) => string
type ChannelBarRow = { Channel: string; Count: number }
type ErrorBarRow = { Error: string; Count: number; Code: string }
type TrendRow = { Time: string; Count: number }
type ChartRow = ChannelBarRow | ErrorBarRow | TrendRow

export type ErrorChartSpec = {
  type: 'bar' | 'area'
  data: Array<{ id: string; values: ChartRow[] }>
  xField: 'Channel' | 'Error' | 'Time'
  yField: 'Count'
  seriesField?: 'Channel' | 'Error'
  legends: { visible: boolean }
  color: { type: string; domain: string[]; range: string[] }
  title: { visible: boolean; text: string }
  tooltip: {
    mark: {
      content: Array<{
        key: (datum: Record<string, unknown>) => unknown
        value: (datum: Record<string, unknown>) => number
      }>
    }
  }
  background: { fill: string }
  animation: boolean
  bar?: { style: { cornerRadius?: number } }
  area?: { style: { fillOpacity: number; curveType: string } }
  line?: { style: { lineWidth: number; curveType: string } }
  point?: { visible: boolean }
}

export type ErrorChartSpecs = {
  spec_channel_bar: ErrorChartSpec
  spec_error_bar: ErrorChartSpec
  spec_trend_line: ErrorChartSpec
}

const MAX_BAR_ITEMS = 20
const MAX_TREND_POINTS = 30

const ERROR_CATEGORY_LABELS: Record<string, string> = {
  rate_limit: 'Rate limit',
  quota: 'Quota',
  unavailable: 'Unavailable',
  not_found: 'Not found',
  timeout: 'Timeout',
  zero_output: 'Zero output',
  upstream: 'Upstream',
  auth: 'Authentication',
  invalid_request: 'Invalid request',
  unknown: 'Unknown',
}

function errorCategoryLabel(code: string): string {
  return ERROR_CATEGORY_LABELS[code] ?? code
}

function channelLabel(stats: ErrorAnalysisStats, channelId: string): string {
  const name = stats.detail?.find(
    (item) => item.channel_id === Number(channelId)
  )?.channel_name
  if (name) return name
  return `#${channelId}`
}

function ordinalColor(domain: string[]) {
  const colorDomain = domain.length > 0 ? domain : ['Count']
  return {
    type: 'ordinal',
    domain: colorDomain,
    range: getDashboardChartColors(colorDomain.length),
  }
}

function barDomain(
  values: ChannelBarRow[] | ErrorBarRow[],
  xField: 'Channel' | 'Error'
): string[] {
  if (xField === 'Channel') {
    return (values as ChannelBarRow[]).map((row) => row.Channel)
  }
  return (values as ErrorBarRow[]).map((row) => row.Error)
}

function buildBarSpec(
  values: ChannelBarRow[] | ErrorBarRow[],
  xField: 'Channel' | 'Error',
  title: string,
  chartCornerRadius?: number
): ErrorChartSpec {
  const domain = barDomain(values, xField)
  return {
    type: 'bar',
    data: [{ id: `${xField.toLowerCase()}Data`, values }],
    xField,
    yField: 'Count',
    seriesField: xField,
    legends: { visible: false },
    color: ordinalColor(domain),
    title: {
      visible: true,
      text: title,
    },
    bar: {
      style:
        chartCornerRadius == null ? {} : { cornerRadius: chartCornerRadius },
    },
    tooltip: {
      mark: {
        content: [
          {
            key: (datum: Record<string, unknown>) => {
              if (xField !== 'Error') {
                return datum?.[xField]
              }
              const code = datum?.Code
              if (typeof code === 'string' && code !== '') {
                return `${datum?.[xField]} (${code})`
              }
              return datum?.[xField]
            },
            value: (datum: Record<string, unknown>) =>
              Number(datum?.Count) || 0,
          },
        ],
      },
    },
    background: { fill: 'transparent' },
    animation: false,
  }
}

function buildTrendSpec(values: TrendRow[], title: string): ErrorChartSpec {
  return {
    type: 'area',
    data: [{ id: 'errorTrendData', values }],
    xField: 'Time',
    yField: 'Count',
    legends: { visible: false },
    color: ordinalColor(['Count']),
    title: {
      visible: true,
      text: title,
    },
    tooltip: {
      mark: {
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.Time,
            value: (datum: Record<string, unknown>) =>
              Number(datum?.Count) || 0,
          },
        ],
      },
    },
    area: {
      style: {
        fillOpacity: 0.08,
        curveType: 'monotone',
      },
    },
    line: {
      style: {
        lineWidth: 2,
        curveType: 'monotone',
      },
    },
    point: { visible: false },
    background: { fill: 'transparent' },
    animation: false,
  }
}

export function buildErrorChartSpecs(
  stats: ErrorAnalysisStats,
  t: TFunction,
  granularity: TimeGranularity = 'hour',
  chartCornerRadius?: number
): ErrorChartSpecs {
  const channelValues = Object.entries(stats.by_channel ?? {})
    .map(([channelId, count]) => ({
      Channel: channelLabel(stats, channelId),
      Count: count,
    }))
    .sort((left, right) => right.Count - left.Count)
    .slice(0, MAX_BAR_ITEMS)

  const errorValues = Object.entries(stats.by_error ?? {})
    .map(([code, count]) => ({
      Error: t(errorCategoryLabel(code)),
      Count: count,
      Code: code,
    }))
    .sort((left, right) => right.Count - left.Count)
    .slice(0, MAX_BAR_ITEMS)

  const trendValues = (stats.by_date ?? [])
    .map((item) => ({
      Time: formatChartTime(Number(item.date), granularity),
      Count: item.total,
    }))
    .slice(-MAX_TREND_POINTS)

  return {
    spec_channel_bar: buildBarSpec(
      channelValues,
      'Channel',
      t('Error Distribution'),
      chartCornerRadius
    ),
    spec_error_bar: buildBarSpec(
      errorValues,
      'Error',
      t('Error Distribution'),
      chartCornerRadius
    ),
    spec_trend_line: buildTrendSpec(trendValues, t('Error Trend')),
  }
}
