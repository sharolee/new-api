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
import { AlertTriangle, AlertOctagon, BarChart3, LineChart } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { useTheme } from '@/context/theme-provider'
import { DEFAULT_TIME_GRANULARITY } from '@/features/dashboard/constants'
import { buildErrorChartSpecs } from '@/features/dashboard/lib/error-charts'
import type {
  ErrorAnalysisChartTab,
  ErrorAnalysisStats,
} from '@/features/dashboard/types'
import { useThemeRadiusPx } from '@/lib/theme-radius'
import type { TimeGranularity } from '@/lib/time'
import { cn } from '@/lib/utils'
import { VCHART_OPTION } from '@/lib/vchart'

const CHART_SPEC_KEYS: Record<
  ErrorAnalysisChartTab,
  'spec_channel_bar' | 'spec_error_bar' | 'spec_trend_line'
> = {
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
  const [stats, setStats] = useState<ErrorAnalysisStats | null>(null)
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
      setStats(result.data ?? null)
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
    if (!stats) {
      return {
        spec_channel_bar: null,
        spec_error_bar: null,
        spec_trend_line: null,
      }
    }
    return buildErrorChartSpecs(stats, t, timeGranularity, themeRadius)
  }, [stats, t, timeGranularity, themeRadius])

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
