/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { VChart } from '@visactor/react-vchart'
import { AlertTriangle, AlertOctagon, BarChart3, GitBranch, LineChart } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { useTheme } from '@/context/theme-provider'
import { DEFAULT_TIME_GRANULARITY, getDashboardChartColors } from '@/features/dashboard/constants'
import type { ErrorAnalysisChartTab } from '@/features/dashboard/types'
import { useThemeRadiusPx } from '@/lib/theme-radius'
import type { TimeGranularity } from '@/lib/time'
import { cn } from '@/lib/utils'
import { VCHART_OPTION } from '@/lib/vchart'

const CHART_SPEC_KEYS: Record<ErrorAnalysisChartTab, string> = {
  channel: 'spec_channel_bar',
  error: 'spec_error_bar',
  trend: 'spec_trend_line',
}

interface ErrorAnalysisChartProps {
  filters?: {
    start_timestamp?: number
    end_timestamp?: number
    time_granularity?: TimeGranularity
    username?: string
    model_name?: string
    channel?: number
  }
  isAdmin?: boolean
  defaultChartTab?: ErrorAnalysisChartTab
}

export function ErrorAnalysisChart(props: ErrorAnalysisChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const themeRadius = useThemeRadiusPx('--radius-md')
  const [activeTab, setActiveTab] = useState<ErrorAnalysisChartTab>(
    props.defaultChartTab ?? 'trend'
  )
  const [stats, setStats] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const timeGranularity = props.filters?.time_granularity ?? DEFAULT_TIME_GRANULARITY
  const themeManagerRef = useRef<any>(null)

  useEffect(() => {
    if (props.defaultChartTab) setActiveTab(props.defaultChartTab)
  }, [props.defaultChartTab])

  useEffect(() => {
    const importVchart = async () => {
      const { ThemeManager } = await import('@visactor/vchart')
      themeManagerRef.current = ThemeManager
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
    }
    void importVchart()
  }, [resolvedTheme])

  const fetchErrorStats = useCallback(async () => {
    setLoading(true)
    setError(false)

    const { getErrorLogStats } = await import('@/features/dashboard/api')
    try {
      const result = await getErrorLogStats(
        {
          start_timestamp: props.filters?.start_timestamp || 0,
          end_timestamp: props.filters?.end_timestamp || 0,
          granularity: timeGranularity,
          username: props.filters?.username || undefined,
          model_name: props.filters?.model_name || undefined,
          channel: props.filters?.channel || undefined,
        },
        props.isAdmin || false
      )
      setStats(result?.data || result)
    } catch {
      setError(true)
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [props.filters, props.isAdmin, timeGranularity])

  useEffect(() => {
    void fetchErrorStats()
  }, [fetchErrorStats])

  const chartSpecs = useMemo(() => {
    if (!stats) return { spec_channel_bar: null, spec_error_bar: null, spec_trend_line: null }
    return buildErrorChartSpecs(stats, t, resolvedTheme, themeRadius)
  }, [stats, t, resolvedTheme, themeRadius])

  const chartKey = [
    activeTab,
    stats?.total ?? 0,
    resolvedTheme,
    loading ? 'loading' : 'ready',
  ].join('-')

  const tabOptions = [
    { value: 'trend', label: t('Error Trend'), icon: LineChart },
    { value: 'channel', label: t('By Channel'), icon: BarChart3 },
    { value: 'error', label: t('By Error Type'), icon: AlertTriangle },
  ]

  const spec = chartSpecs[CHART_SPEC_KEYS[activeTab]]

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex flex-col gap-1.5 border-b px-3 py-2 sm:gap-3 sm:px-5 sm:py-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex items-center gap-2'>
          <IconBadge tone='chart-4' size='sm'>
            <AlertOctagon />
          </IconBadge>
          <div className='text-sm font-semibold'>{t('Error Analysis')}</div>
          <span className='text-muted-foreground text-xs'>
            {t('Total Errors:')} {(stats?.total ?? 0).toLocaleString()}
          </span>
        </div>
        <div className='bg-muted/60 inline-flex h-7 w-full overflow-x-auto rounded-lg border p-0.5 sm:h-8 sm:w-auto'>
          {tabOptions.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.value}
                type='button'
                onClick={() => setActiveTab(tab.value as ErrorAnalysisChartTab)}
                className={cn(
                  'shrink-0 rounded-md px-3 text-xs font-medium transition-colors flex items-center gap-1',
                  activeTab === tab.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className='size-3' />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className='h-[300px] p-1.5 sm:h-96 sm:p-2'>
        {!loading && !error && spec && (
          <VChart
            key={chartKey}
            spec={{ ...spec, theme: resolvedTheme === 'dark' ? 'dark' : 'light', background: 'transparent' }}
            option={VCHART_OPTION}
          />
        )}
        {(loading || error) && (
          <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
            {loading ? t('Loading...') : t('Failed to load error data')}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Chart spec builders
// ============================================================================

function buildErrorChartSpecs(
  stats: any,
  t: (k: string) => string,
  theme: string,
  _radius: number
): Record<string, any> {
  const isDark = theme === 'dark'
  const baseColor = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)'
  const mutedColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'

  const channelData = Object.entries(stats.by_channel ?? {})
    .map(([channelId, count]: [string, number]) => ({
      name:
        stats.detail?.find((d: any) => d.channel_id === Number(channelId))?.channel_name ||
        `#${channelId}`,
      value: count,
    }))
    .sort((a: any, b: any) => b.value - a.value)
    .slice(0, 20)

  const errorData = Object.entries(stats.by_error ?? {})
    .map(([code, count]: [string, number]) => ({ name: code, value: count }))
    .sort((a: any, b: any) => b.value - a.value)
    .slice(0, 20)

  const dateData = (stats.by_date ?? [])
    .map((d: any) => {
      const date = new Date(Number(d.date) * 1000)
      const dateStr = date.toISOString().slice(5, 10).replace('T', ' ')
      const hourStr = date.toISOString().slice(11, 16)
      return { date: dateStr + ' ' + hourStr, total: d.total }
    })
    .slice(-30)

  return {
    spec_channel_bar: buildBarSpec(channelData, t, baseColor, mutedColor, gridColor, 'Channel'),
    spec_error_bar: buildBarSpec(errorData, t, baseColor, mutedColor, gridColor, 'Error Type'),
    spec_trend_line: buildTrendSpec(dateData, t, baseColor, mutedColor, gridColor),
  }
}

function buildBarSpec(
  data: any[],
  t: (k: string) => string,
  baseColor: string,
  mutedColor: string,
  gridColor: string,
  axisLabel: string
): any {
  const colors = getDashboardChartColors(Math.max(1, data.length))
  return {
    type: 'bar',
    name: t('Error Distribution'),
    data: { id: 'errorData' },
    dataField: 'value',
    categoryField: 'name',
    encode: { x: 'name', y: 'value' },
    color: 'category',
    label: {
      visible: true,
      position: 'top',
      color: baseColor,
      fontSize: 10,
    },
    tooltip: {
      content: (datum: any) => `${datum.name}: ${datum.value}`,
    },
    seriesLabel: { visible: false },
    axis: {
      x: {
        type: 'band',
        label: { color: baseColor, fontSize: 9, rotate: 45, align: 'center' },
        grid: { visible: false },
        title: { text: axisLabel, color: mutedColor, fontSize: 10 },
      },
      y: {
        type: 'value',
        label: { color: baseColor, fontSize: 10 },
        grid: { line: { stroke: gridColor } },
      },
    },
    color: {
      domain: colors.slice(0, Math.max(1, data.length)),
    },
    legend: { visible: false },
    padding: 4,
    width: '100%',
    height: '100%',
    data: {
      id: 'errorData',
      values: data,
    },
    animation: false,
  }
}

function buildTrendSpec(
  data: any[],
  t: (k: string) => string,
  baseColor: string,
  mutedColor: string,
  gridColor: string
): any {
  const chartColors = getDashboardChartColors(3)
  const topErrors = data.length > 0
    ? [...new Set(data.map((d: any) => d.error_codes?.join(', ')))].slice(0, 3)
    : []

  return {
    type: 'line',
    name: t('Error Trend'),
    data: { id: 'errorTrendData' },
    dataField: 'total',
    categoryField: 'date',
    encode: { x: 'date', y: 'total' },
    smooth: true,
    markPoint: {
      type: 'max',
      shape: 'circle',
      symbolSize: 8,
      label: { visible: false },
    },
    markArea: {
      type: 'rect',
    },
    tooltip: {
      content: (datum: any) => `${datum.date}: ${datum.total} errors`,
    },
    seriesLabel: { visible: false },
    axis: {
      x: {
        type: 'band',
        label: { color: baseColor, fontSize: 9, rotate: 30 },
        grid: { visible: false },
      },
      y: {
        type: 'value',
        label: { color: baseColor, fontSize: 10 },
        grid: { line: { stroke: gridColor } },
      },
    },
    color: chartColors[0] || (baseColor === 'rgba(255,255,255,0.8)' ? '#4a90d9' : '#3b82f6'),
    legend: { visible: false },
    padding: 4,
    width: '100%',
    height: '100%',
    data: {
      id: 'errorTrendData',
      values: data,
    },
    animation: false,
    _topErrors: topErrors,
  }
}
