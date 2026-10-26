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
import { VChart } from '@visactor/react-vchart'
import { AreaChart, BarChart3, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { useThemeCustomization } from '@/context/theme-customization-provider'
import { useTheme } from '@/context/theme-provider'
import {
  CONSUMPTION_DISTRIBUTION_CHART_OPTIONS,
  DEFAULT_TIME_GRANULARITY,
  getDashboardChartColors,
} from '@/features/dashboard/constants'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatChartTime, type TimeGranularity } from '@/lib/time'
import { VCHART_OPTION } from '@/lib/vchart'
import type {
  ConsumptionDistributionChartType,
  TokenQuotaDataItem,
} from '@/features/dashboard/types'
import { useThemeRadiusPx } from '@/lib/theme-radius'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

interface TokenConsumptionDistributionChartProps {
  data: TokenQuotaDataItem[]
  loading?: boolean
  timeGranularity?: TimeGranularity
  defaultChartType?: ConsumptionDistributionChartType
}

const CHART_TYPE_ICONS: Record<
  ConsumptionDistributionChartType,
  typeof BarChart3
> = {
  bar: BarChart3,
  area: AreaChart,
}

export function TokenConsumptionDistributionChart(
  props: TokenConsumptionDistributionChartProps
) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const { customization } = useThemeCustomization()
  const chartRadius = useThemeRadiusPx(
    '--radius-md',
    `${customization.preset}:${customization.radius}`
  )
  const [chartType, setChartType] = useState<ConsumptionDistributionChartType>(
    props.defaultChartType ?? 'bar'
  )
  const [themeReady, setThemeReady] = useState(false)
  const themeManagerRef = useRef<
    (typeof import('@visactor/vchart'))['ThemeManager'] | null
  >(null)
  const timeGranularity = props.timeGranularity ?? DEFAULT_TIME_GRANULARITY

  useEffect(() => {
    if (props.defaultChartType) setChartType(props.defaultChartType)
  }, [props.defaultChartType])

  useEffect(() => {
    const updateTheme = async () => {
      setThemeReady(false)

      if (!themeManagerPromise) {
        themeManagerPromise = import('@visactor/vchart').then(
          (m) => m.ThemeManager
        )
      }

      const ThemeManager = await themeManagerPromise
      themeManagerRef.current = ThemeManager
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    }

    updateTheme()
  }, [resolvedTheme])

  const { spec, totalDisplay } = useMemo(() => {
    const data = props.loading ? [] : props.data

    const { config } = getCurrencyDisplay()
    const quotaPerUnit = config.quotaPerUnit

    const formatQuotaValue = (value: number) => {
      const usd = value / quotaPerUnit
      return usd.toFixed(4)
    }
    const formatQuotaTotal = (value: number) => {
      const usd = value / quotaPerUnit
      return `$${usd.toFixed(2)}`
    }

    if (!data || data.length === 0) {
      return {
        spec: {
          type: 'bar' as const,
          data: [{ id: 'tokenConsumptionBar', values: [] }],
          xField: 'Time',
          yField: 'Usage',
          seriesField: 'Token',
          stack: true,
          legends: { visible: true, selectMode: 'single' },
          title: {
            visible: true,
            text: t('Quota Distribution'),
            subtext: t('No data available'),
          },
        },
        totalDisplay: formatQuotaTotal(0),
      }
    }

    // Aggregate by time and token
    const timeTokenMap = new Map<
      string,
      Map<string, { quota: number; tokens: number; count: number }>
    >()
    const tokenTotalsMap = new Map<
      string,
      { quota: number; tokens: number; count: number }
    >()

    data.forEach((item) => {
      const timestamp = Number(item.created_at)
      const timeKey = formatChartTime(timestamp, timeGranularity)
      const token = item.token_name || `#${item.token_id}`
      const quota = Number(item.quota) || 0
      const tokens = Number(item.token_used) || 0
      const count = Number(item.count) || 0

      if (!timeTokenMap.has(timeKey)) {
        timeTokenMap.set(timeKey, new Map())
      }
      const tokenMap = timeTokenMap.get(timeKey)
      if (!tokenMap) return
      const existing = tokenMap.get(token) || { quota: 0, tokens: 0, count: 0 }
      tokenMap.set(token, {
        quota: existing.quota + quota,
        tokens: existing.tokens + tokens,
        count: existing.count + count,
      })

      const totalExisting = tokenTotalsMap.get(token) || {
        quota: 0,
        tokens: 0,
        count: 0,
      }
      tokenTotalsMap.set(token, {
        quota: totalExisting.quota + quota,
        tokens: totalExisting.tokens + tokens,
        count: totalExisting.count + count,
      })
    })

    const sortedTimes = [...timeTokenMap.keys()].sort()
    const allTokens = [...tokenTotalsMap.keys()].sort()
    const colorDomain = allTokens
    const colorRange = getDashboardChartColors(colorDomain.length + 1)
    const tokenColor = {
      type: 'ordinal' as const,
      domain: colorDomain,
      range: colorRange,
    }

    const barValues: Array<{
      Time: string
      Token: string
      rawQuota: number
      Usage: number
      TimeSum: number
    }> = []
    const areaValues: Array<{
      Time: string
      Token: string
      rawQuota: number
      Usage: number
      TimeSum: number
    }> = []

    const MAX_AREA_TOKENS = 15
    const rankedQuotaTokens = [...tokenTotalsMap.entries()]
      .map(([token, stats]) => ({
        Token: token,
        Quota: Number(stats.quota) || 0,
      }))
      .sort((a, b) => b.Quota - a.Quota)
    const topAreaTokens = new Set(
      rankedQuotaTokens.slice(0, MAX_AREA_TOKENS).map((m) => m.Token)
    )
    const otherLabel = t('Other')

    sortedTimes.forEach((time) => {
      // Bar values - all tokens
      let timeData = allTokens.map((token) => {
        const stats = timeTokenMap.get(time)?.get(token)
        const rawQuota = Number(stats?.quota) || 0
        return {
          Time: time,
          Token: token,
          rawQuota,
          Usage: rawQuota ? Number(formatQuotaValue(rawQuota)) : 0,
          TimeSum: 0,
        }
      })
      const timeSum = timeData.reduce((sum, item) => sum + item.rawQuota, 0)
      timeData.sort((a, b) => b.rawQuota - a.rawQuota)
      timeData = timeData.map((item) => ({ ...item, TimeSum: timeSum }))
      barValues.push(...timeData)

      // Area - top tokens + Other
      const buckets = new Map<string, { rawQuota: number; usage: number }>()
      let areaTimeSum = 0
      allTokens.forEach((token) => {
        const stats = timeTokenMap.get(time)?.get(token)
        const rawQuota = Number(stats?.quota) || 0
        const usage = rawQuota ? Number(formatQuotaValue(rawQuota)) : 0
        areaTimeSum += rawQuota
        const key = topAreaTokens.has(token) ? token : otherLabel
        const prev = buckets.get(key) || { rawQuota: 0, usage: 0 }
        buckets.set(key, {
          rawQuota: prev.rawQuota + rawQuota,
          usage: Number((prev.usage + usage).toFixed(4)),
        })
      })
      buckets.forEach((vals, token) => {
        areaValues.push({
          Time: time,
          Token: token,
          rawQuota: vals.rawQuota,
          Usage: vals.usage,
          TimeSum: areaTimeSum,
        })
      })
    })
    barValues.sort((a, b) => a.Time.localeCompare(b.Time))
    areaValues.sort((a, b) => a.Time.localeCompare(b.Time))

    const totalQuotaRaw = [...tokenTotalsMap.values()].reduce(
      (sum, x) => sum + (Number(x.quota) || 0),
      0
    )

    const baseSpec = {
      xField: 'Time',
      yField: 'Usage',
      seriesField: 'Token',
      color: tokenColor,
      bar: {
        state: { hover: { stroke: '#000', lineWidth: 1 } },
        style:
          chartRadius == null ? {} : { cornerRadius: chartRadius },
      },
      background: { fill: 'transparent' },
      animation: true,
    }

    if (chartType === 'bar') {
      return {
        spec: {
          type: 'bar' as const,
          data: [{ id: 'tokenConsumptionBar', values: barValues }],
          ...baseSpec,
          stack: true,
          legends: { visible: true, selectMode: 'single' },
        },
        totalDisplay: formatQuotaTotal(totalQuotaRaw),
      }
    }
    return {
      spec: {
        type: 'area' as const,
        data: [{ id: 'tokenConsumptionArea', values: areaValues }],
        ...baseSpec,
        stack: false,
        legends: { visible: true, selectMode: 'single' },
        area: { style: { fillOpacity: 0.08, curveType: 'monotone' } },
        line: { style: { lineWidth: 2, curveType: 'monotone' } },
        point: { visible: false },
      },
      totalDisplay: formatQuotaTotal(totalQuotaRaw),
    }
  }, [props.data, props.loading, timeGranularity, t, chartType, chartRadius])

  const specType = typeof spec?.type === 'string' ? spec.type : chartType
  const chartKey = [
    chartType,
    specType,
    props.loading ? 'loading' : 'ready',
    props.data.length,
    resolvedTheme,
    customization.preset,
  ].join('-')

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex w-full flex-col gap-1.5 border-b px-3 py-2 sm:gap-3 sm:px-5 sm:py-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex items-center gap-2'>
          <IconBadge tone='success' size='sm'>
            <WalletCards />
          </IconBadge>
          <div className='text-sm font-semibold'>{t('Quota Distribution')}</div>
          <span className='text-muted-foreground text-xs'>
            {t('Total:')} {totalDisplay}
          </span>
        </div>

        <div className='bg-muted/60 inline-flex h-7 w-full overflow-x-auto rounded-lg border p-0.5 sm:h-8 sm:w-auto'>
          {CONSUMPTION_DISTRIBUTION_CHART_OPTIONS.map((item) => {
            const Icon = CHART_TYPE_ICONS[item.value]
            return (
              <button
                key={item.value}
                type='button'
                onClick={() => setChartType(item.value)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                  chartType === item.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className='size-3.5' />
                {t(item.labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      <div className='h-[300px] p-1.5 sm:h-96 sm:p-2'>
        {themeReady && spec && (
          <VChart
            key={chartKey}
            spec={{
              ...spec,
              theme: resolvedTheme === 'dark' ? 'dark' : 'light',
              background: 'transparent',
            }}
            option={VCHART_OPTION}
          />
        )}
      </div>
    </div>
  )
}
