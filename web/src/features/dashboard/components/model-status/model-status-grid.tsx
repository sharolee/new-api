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
import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { IconBadge } from '@/components/ui/icon-badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getModelRequestStatuses } from '@/features/dashboard/api'
import type {
  ModelRequestResult,
  ModelRequestRow,
} from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  buildGridCells,
  getModelStatusMeta,
  MODEL_STATUS_META,
  MODEL_STATUS_ORDER,
} from './lib/status-map'

const TIME_RANGE_PRESETS = [
  { labelKey: 'Last hour', hours: 1 },
  { labelKey: 'Last 6 hours', hours: 6 },
  { labelKey: 'Last 24 hours', hours: 24 },
  { labelKey: 'Last 7 days', hours: 168 },
] as const

const LIMIT_OPTIONS = [10, 20, 50] as const

const AGGREGATE_OPTIONS = [
  { value: 'model_name' as const, labelKey: 'By request model' },
  { value: 'upstream_model_name' as const, labelKey: 'By upstream model' },
] as const

const GRID_CELL_CLASS = 'size-4 rounded-[4px] sm:size-5'

type AggregateBy = 'model_name' | 'upstream_model_name'

function ModelStatusGridSkeleton() {
  return (
    <div className='p-1.5 sm:p-2' data-slot='model-status-grid-skeleton'>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 pb-2 sm:px-2.5'>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className='h-3 w-16' />
        ))}
      </div>
      <div className='space-y-2'>
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} className='flex items-center gap-2 px-2 py-1.5'>
            <Skeleton className='h-4 w-36 shrink-0 sm:w-44' />
            <div className='flex gap-1'>
              {Array.from({ length: 20 }, (_, cell) => (
                <Skeleton key={cell} className={cn(GRID_CELL_CLASS)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RequestTooltipContent(props: {
  row: ModelRequestRow
  result: ModelRequestResult
  formatTime: (timestamp: number) => string
}) {
  const { t } = useTranslation()
  const meta = getModelStatusMeta(props.result.status)

  return (
    <div className='flex max-w-xs flex-col gap-1'>
      <div className='flex items-center gap-1.5 font-medium'>
        <span
          className={cn('size-2 shrink-0 rounded-full', meta.dotClass)}
          aria-hidden='true'
        />
        {t(meta.labelKey)}
      </div>
      <div className='text-muted-foreground font-mono text-xs break-all'>
        {props.row.model}
      </div>
      <div>{props.formatTime(props.result.created_at)}</div>
      {props.result.channel_name && (
        <div className='text-muted-foreground'>
          {t('Channel')}: {props.result.channel_name}
        </div>
      )}
      {(props.result.error_category || props.result.error_code) && (
        <div className='text-muted-foreground font-mono text-xs break-all'>
          {[props.result.error_category, props.result.error_code]
            .filter(Boolean)
            .join(' ')}
        </div>
      )}
      {props.result.end_reason && (
        <div className='text-muted-foreground font-mono text-xs break-all'>
          {t('End reason')}: {props.result.end_reason}
        </div>
      )}
      {props.result.content && (
        <div className='text-muted-foreground line-clamp-2 break-words'>
          {props.result.content}
        </div>
      )}
    </div>
  )
}

function ModelStatusRow(props: {
  row: ModelRequestRow
  limit: number
  formatTime: (timestamp: number) => string
}) {
  const { t } = useTranslation()
  const cells = buildGridCells(props.row.requests, props.limit)

  return (
    <div
      className='flex items-center gap-2 px-2 py-1.5 sm:gap-2.5'
      data-slot='model-status-row'
    >
      <div
        className='flex w-36 shrink-0 items-center gap-1 sm:w-44'
        title={props.row.model}
      >
        <span className='text-muted-foreground block truncate font-mono text-xs font-medium'>
          {props.row.model}
        </span>
        {props.row.client_gone_count > 0 && (
          <span
            aria-label={`${t('Stream lost')}: ${props.row.client_gone_count}`}
            className='bg-chart-1/15 text-chart-1 shrink-0 rounded px-1 font-mono text-[10px] leading-4'
            title={`${t('Stream lost')}: ${props.row.client_gone_count}`}
          >
            {props.row.client_gone_count}
          </span>
        )}
      </div>
      <div className='flex gap-1 sm:gap-1.5'>
        {cells.map((cell) => {
          if (cell.result) {
            const meta = getModelStatusMeta(cell.result.status)
            return (
              <Tooltip key={cell.id}>
                <TooltipTrigger
                  render={
                    <div
                      aria-label={`${props.row.model} ${t(meta.labelKey)} ${props.formatTime(cell.result.created_at)}`}
                      className={cn(GRID_CELL_CLASS, meta.dotClass)}
                      data-status={cell.result.status}
                    />
                  }
                />
                <TooltipContent>
                  <RequestTooltipContent
                    row={props.row}
                    result={cell.result}
                    formatTime={props.formatTime}
                  />
                </TooltipContent>
              </Tooltip>
            )
          }
          return (
            <Tooltip key={cell.id}>
              <TooltipTrigger
                render={
                  <div
                    aria-label={`${props.row.model} ${t('No data')}`}
                    className={cn(
                      GRID_CELL_CLASS,
                      'border border-border/60 bg-transparent'
                    )}
                    data-status='no-data'
                  />
                }
              />
              <TooltipContent>{t('No data')}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

export function ModelStatusGrid() {
  const { t, i18n } = useTranslation()
  const userRole = useAuthStore((state) => state.auth.user?.role)
  const isAdmin = Boolean(userRole && userRole >= ROLE.ADMIN)

  const [timeRangeHours, setTimeRangeHours] = useState(6)
  const [limit, setLimit] = useState(20)
  const [aggregateBy, setAggregateBy] = useState<AggregateBy>(
    'upstream_model_name'
  )

  const { start_timestamp, end_timestamp } = useMemo(() => {
    const end = Math.floor(Date.now() / 1000)
    return {
      start_timestamp: end - timeRangeHours * 3600,
      end_timestamp: end,
    }
  }, [timeRangeHours])

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(
        toIntlLocale(i18n.resolvedLanguage ?? i18n.language),
        { dateStyle: 'medium', timeStyle: 'short' }
      ),
    [i18n.resolvedLanguage, i18n.language]
  )

  const query = useQuery({
    queryKey: [
      'dashboard',
      'model-status',
      isAdmin ? 'admin' : 'self',
      { start_timestamp, end_timestamp, limit, aggregate_by: aggregateBy },
    ],
    queryFn: async () => {
      const result = requireServerSuccess(
        await getModelRequestStatuses(
          {
            start_timestamp,
            end_timestamp,
            limit,
            aggregate_by: aggregateBy,
          },
          isAdmin
        )
      )
      return result.success ? (result.data ?? []) : []
    },
    staleTime: 60 * 1000,
  })

  const rows = query.data ?? []
  const isLoading = query.isPending
  const isError = query.isError

  let body: ReactNode
  if (isLoading) {
    body = <ModelStatusGridSkeleton />
  } else if (isError) {
    body = (
      <Empty className='m-3 min-h-40 sm:m-5'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Activity className='text-destructive' aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('Failed to load model status')}</EmptyTitle>
          <EmptyDescription>{t('Please try again later.')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else if (rows.length === 0) {
    body = (
      <Empty className='m-3 min-h-40 sm:m-5'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Activity aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No request data for the selected range')}</EmptyTitle>
        </EmptyHeader>
        <EmptyDescription>
          {t('Adjust the time range or limit to see request status dots.')}
        </EmptyDescription>
      </Empty>
    )
  } else {
    body = (
      <>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3 py-2 sm:px-5'>
          {MODEL_STATUS_ORDER.map((status) => (
            <div
              key={status}
              className='text-muted-foreground flex items-center gap-1.5 text-xs'
            >
              <span
                className={cn(
                  'size-2 rounded-full',
                  MODEL_STATUS_META[status].dotClass
                )}
                aria-hidden='true'
              />
              {t(MODEL_STATUS_META[status].labelKey)}
            </div>
          ))}
        </div>
        <div className='overflow-x-auto p-1.5 sm:p-2'>
          <div className='min-w-max'>
            <div className='flex items-center gap-2 px-2 pb-1.5 sm:gap-2.5'>
              <div className='w-36 shrink-0 sm:w-44'>
                <span className='text-muted-foreground block text-xs font-medium'>
                  {t('Model')}
                </span>
              </div>
              <div className='text-muted-foreground text-xs'>
                ← {t('Latest')}
              </div>
            </div>
            {rows.map((row) => (
              <ModelStatusRow
                key={row.model}
                row={row}
                limit={limit}
                formatTime={(timestamp) =>
                  timeFormatter.format(new Date(timestamp * 1000))
                }
              />
            ))}
          </div>
        </div>
      </>
    )
  }

  return (
    <div
      className='overflow-hidden rounded-lg border'
      data-slot='model-status-grid'
    >
      <div className='flex flex-col gap-1.5 border-b px-3 py-2 sm:gap-3 sm:px-5 sm:py-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex items-center gap-2'>
          <IconBadge tone='chart-4' size='sm'>
            <Activity />
          </IconBadge>
          <div className='text-sm font-semibold'>{t('Recent requests')}</div>
        </div>
        <div className='flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2'>
          <div
            className='bg-muted/60 inline-flex h-7 shrink-0 items-center overflow-hidden rounded-lg border p-0.5 sm:h-8'
            role='group'
            aria-label={t('Time range')}
          >
            {TIME_RANGE_PRESETS.map((preset) => (
              <button
                key={preset.labelKey}
                type='button'
                onClick={() => setTimeRangeHours(preset.hours)}
                className={cn(
                  'shrink-0 rounded-md px-3 text-xs font-medium transition-colors',
                  timeRangeHours === preset.hours
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(preset.labelKey)}
              </button>
            ))}
          </div>
          <Select
            items={LIMIT_OPTIONS.map((value) => ({
              value: String(value),
              label: String(value),
            }))}
            value={String(limit)}
            onValueChange={(value) => setLimit(Number(value))}
          >
            <SelectTrigger
              size='sm'
              className='h-7 w-28 sm:h-8 sm:w-32'
              aria-label={t('Limit per model')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {LIMIT_OPTIONS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div
            className='bg-muted/60 inline-flex h-7 shrink-0 items-center overflow-hidden rounded-lg border p-0.5 sm:h-8'
            role='group'
            aria-label={t('Aggregate by')}
          >
            {AGGREGATE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type='button'
                onClick={() => setAggregateBy(option.value)}
                className={cn(
                  'shrink-0 rounded-md px-3 text-xs font-medium transition-colors',
                  aggregateBy === option.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
      {body}
    </div>
  )
}
