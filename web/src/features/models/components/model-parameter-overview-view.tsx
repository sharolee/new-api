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
import { getRouteApi } from '@tanstack/react-router'
import type { ColumnDef, OnChangeFn, SortingState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTableColumnHeader,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getModelParameterOverview } from '../api'
import { DEFAULT_PAGE_SIZE } from '../constants'
import { modelOverviewQueryKeys } from '../lib'
import type { GetModelOverviewParams, ModelOverviewRow } from '../types'

const route = getRouteApi('/_authenticated/models/$section')

const CAPABILITY_FILTERS = [
  { label: 'Reasoning', value: 'reasoning' },
  { label: 'Vision', value: 'vision' },
  { label: 'Tool call', value: 'tool_call' },
  { label: 'Structured output', value: 'structured_output' },
] as const

// Capability value → existing i18n label key (same labels as the
// parameters table).
const CAPABILITY_LABELS: Record<string, string> = {
  reasoning: 'Reasoning',
  vision: 'Vision',
  tool_call: 'Tool call',
  structured_output: 'Structured output',
}

const SORTABLE_COLUMNS = new Set(['name', 'context', 'output'])

const UNMATCHED_ROW_CLASS =
  '[--data-table-card-bg:var(--table-disabled)] hover:[--data-table-card-bg:var(--table-disabled-hover)] data-[state=selected]:![--data-table-card-bg:var(--table-disabled)] data-[state=selected]:hover:![--data-table-card-bg:var(--table-disabled-hover)] [background-color:var(--table-disabled)] hover:[background-color:var(--table-disabled-hover)] [&>td:first-child]:[border-left-color:var(--warning)] [&>td:first-child]:border-l-4 [&>td:first-child]:pl-1'

function firstFilter(
  columnFilters: { id: string; value: unknown }[],
  id: string
) {
  const raw = columnFilters.find((filter) => filter.id === id)?.value
  const values = Array.isArray(raw) ? (raw as string[]) : []
  return values.length > 0 && values[0] !== 'all' ? values[0] : undefined
}

export function ModelParameterOverviewView() {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [sorting, setSorting] = useState<SortingState>([])

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: {
      defaultPage: 1,
      defaultPageSize: isMobile ? 10 : DEFAULT_PAGE_SIZE,
      pageKey: 'oPage',
      pageSizeKey: 'oPageSize',
    },
    globalFilter: { enabled: true, key: 'oFilter' },
    columnFilters: [
      { columnId: 'capability', searchKey: 'oCapability', type: 'array' },
    ],
  })

  const capabilityFilter = firstFilter(columnFilters, 'capability')

  const sortParams = useMemo(() => {
    const active = sorting[0]
    if (!active || !SORTABLE_COLUMNS.has(active.id)) return {}
    return {
      sort: active.id as GetModelOverviewParams['sort'],
      order: (active.desc ? 'desc' : 'asc') as GetModelOverviewParams['order'],
    }
  }, [sorting])

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater)
    if (pagination.pageIndex > 0) {
      onPaginationChange({ ...pagination, pageIndex: 0 })
    }
  }

  const queryParams: GetModelOverviewParams = {
    keyword: globalFilter?.trim() || undefined,
    capability: capabilityFilter,
    ...sortParams,
    page: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  }

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: modelOverviewQueryKeys.list(queryParams),
    queryFn: async () =>
      requireServerSuccess(await getModelParameterOverview(queryParams)),
  })

  const items = data?.data?.items ?? []
  const totalCount = data?.data?.total ?? 0

  const columns: ColumnDef<ModelOverviewRow>[] = useMemo(() => {
    return [
      {
        accessorKey: 'model',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Model')} />
        ),
        id: 'name',
        size: 240,
        minSize: 180,
        enableHiding: false,
        cell: ({ row }) => (
          <div className='flex min-w-0 flex-col gap-0.5'>
            <span className='truncate font-mono text-sm'>
              {row.original.model}
            </span>
            {row.original.declaredModels.length > 0 && (
              <span className='text-muted-foreground truncate text-xs'>
                {row.original.declaredModels.join(', ')}
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'matched',
        header: t('Matched'),
        size: 100,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.matched ? (
            <span className='text-success text-xs font-medium'>
              {t('Matched')}
            </span>
          ) : (
            <span className='text-destructive text-xs font-medium'>
              {t('Unmatched')}
            </span>
          ),
      },
      {
        accessorKey: 'canonicalKey',
        header: t('Canonical Model'),
        size: 280,
        enableSorting: false,
        cell: ({ row }) => (
          <div className='flex min-w-0 flex-col gap-0.5'>
            {row.original.canonicalKey ? (
              <>
                <span className='truncate font-mono text-sm'>
                  {row.original.canonicalKey}
                </span>
                {row.original.displayName &&
                  row.original.displayName !== row.original.canonicalKey && (
                    <span className='text-muted-foreground truncate text-xs'>
                      {row.original.displayName}
                    </span>
                  )}
              </>
            ) : (
              <span className='text-muted-foreground text-sm'>—</span>
            )}
          </div>
        ),
      },
      {
        id: 'context',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Context')} />
        ),
        size: 110,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.matched ? (
            <span className='text-sm'>
              {row.original.contextLength ?? '—'}
            </span>
          ) : (
            <span className='text-muted-foreground text-sm'>
              {t('Unmatched')}
            </span>
          ),
      },
      {
        id: 'output',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Max output')} />
        ),
        size: 120,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.matched ? (
            <span className='text-sm'>
              {row.original.maxOutputTokens ?? '—'}
            </span>
          ) : (
            <span className='text-muted-foreground text-sm'>
              {t('Unmatched')}
            </span>
          ),
      },
      {
        accessorKey: 'capabilities',
        id: 'capability',
        header: t('Capabilities'),
        size: 220,
        enableSorting: false,
        cell: ({ row }) => {
          const capabilities = row.original.capabilities ?? []
          if (!row.original.matched || capabilities.length === 0) {
            return <span className='text-sm'>—</span>
          }
          return (
            <div className='flex flex-wrap gap-1'>
              {capabilities.map((badge) => (
                <span
                  key={badge}
                  className='bg-muted text-muted-foreground inline-flex h-5 w-fit items-center rounded-4xl px-1.5 text-xs leading-none font-medium whitespace-nowrap'
                >
                  {t(CAPABILITY_LABELS[badge] ?? badge)}
                </span>
              ))}
            </div>
          )
        },
      },
      {
        accessorKey: 'origin',
        header: t('Origin'),
        size: 100,
        enableSorting: false,
        cell: ({ row }) => {
          if (row.original.origin === 'manual') {
            return <span className='text-sm'>{t('Manual')}</span>
          }
          if (row.original.origin === 'auto') {
            return <span className='text-sm'>{t('Auto')}</span>
          }
          return <span className='text-sm'>—</span>
        },
      },
    ]
  }, [t])

  const { table } = useDataTable({
    data: items,
    columns,
    totalCount,
    getRowId: (item) => `overview:${item.model}`,
    columnFilters,
    pagination,
    globalFilter,
    sorting,
    onColumnFiltersChange,
    onPaginationChange,
    onGlobalFilterChange,
    onSortingChange: handleSortingChange,
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
  })

  if (isError) {
    return (
      <div className='flex flex-col items-center justify-center gap-4 py-12'>
        <p className='text-muted-foreground max-w-md text-center text-sm'>
          {error instanceof Error
            ? error.message
            : t('Failed to load model overview')}
        </p>
        <Button variant='outline' size='sm' onClick={() => void refetch()}>
          {t('Retry')}
        </Button>
      </div>
    )
  }

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No models found')}
      emptyDescription={t(
        'No upstream models to display. Models appear here once channels declare them.'
      )}
      skeletonKeyPrefix='model-overview-skeleton'
      applyHeaderSize
      getRowClassName={(row) =>
        !row.original.matched ? UNMATCHED_ROW_CLASS : undefined
      }
      toolbarProps={{
        searchPlaceholder: t('Filter by model name...'),
        searchDebounceMs: 500,
        filters: [
          {
            columnId: 'capability',
            title: t('Capability'),
            options: [
              { label: t('All capabilities'), value: 'all' },
              ...CAPABILITY_FILTERS.map((option) => ({
                label: t(option.label),
                value: option.value,
              })),
            ],
            singleSelect: true,
          },
        ],
      }}
    />
  )
}
