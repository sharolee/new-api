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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

import { deleteModelParameter, getModelParameters, getVendors } from '../api'
import { DEFAULT_PAGE_SIZE } from '../constants'
import { modelParametersQueryKeys, vendorsQueryKeys } from '../lib'
import type { CanonicalModel, GetModelParametersParams } from '../types'
import { useModels } from './models-provider'

const route = getRouteApi('/_authenticated/models/$section')

const CAPABILITY_FILTERS = [
  { label: 'Reasoning', value: 'reasoning' },
  { label: 'Vision', value: 'vision' },
  { label: 'Tool call', value: 'tool_call' },
  { label: 'Structured output', value: 'structured_output' },
] as const

const SOURCE_FILTERS = [
  { label: 'models.dev', value: 'models.dev' },
  { label: 'litellm', value: 'litellm' },
  { label: 'openrouter', value: 'openrouter' },
  { label: 'Manual', value: 'manual' },
] as const

function firstFilter(
  columnFilters: { id: string; value: unknown }[],
  id: string
) {
  const raw = columnFilters.find((filter) => filter.id === id)?.value
  const values = Array.isArray(raw) ? (raw as string[]) : []
  return values.length > 0 && values[0] !== 'all' ? values[0] : undefined
}

export function ModelParametersTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { setParametersDialog, setParameterEditing } = useModels()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [deleteTarget, setDeleteTarget] = useState<CanonicalModel | null>(null)

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
      pageKey: 'pPage',
      pageSizeKey: 'pPageSize',
    },
    globalFilter: { enabled: true, key: 'pFilter' },
    columnFilters: [
      { columnId: 'vendor', searchKey: 'pVendor', type: 'array' },
      { columnId: 'capability', searchKey: 'pCapability', type: 'array' },
      { columnId: 'source', searchKey: 'pSource', type: 'array' },
    ],
  })

  const vendorFilter = firstFilter(columnFilters, 'vendor')
  const capabilityFilter = firstFilter(columnFilters, 'capability')
  const sourceFilter = firstFilter(columnFilters, 'source')

  const queryParams: GetModelParametersParams = {
    keyword: globalFilter?.trim() || undefined,
    vendor: vendorFilter,
    capability: capabilityFilter as GetModelParametersParams['capability'],
    source: sourceFilter,
    page: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  }

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: modelParametersQueryKeys.list(queryParams),
    queryFn: async () =>
      requireServerSuccess(await getModelParameters(queryParams)),
  })

  // Vendor list for the vendor filter dropdown.
  const { data: vendorsData } = useQuery({
    queryKey: vendorsQueryKeys.list(),
    queryFn: async () =>
      requireServerSuccess(await getVendors({ page_size: 1000 })),
  })
  const vendorOptions = useMemo(
    () =>
      (vendorsData?.data?.items ?? []).map((vendor) => ({
        label: vendor.name,
        value: vendor.name,
      })),
    [vendorsData?.data?.items]
  )

  const items = data?.data?.items ?? []
  const totalCount = data?.data?.total ?? 0

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await deleteModelParameter(id)
      if (!res.success) {
        throw createServerError(res, t('Failed to delete model parameter'))
      }
      return res
    },
    onSuccess: async () => {
      toast.success(t('Model parameter deleted'))
      setDeleteTarget(null)
      await queryClient.invalidateQueries({
        queryKey: modelParametersQueryKeys.lists(),
      })
    },
    onError: (error: unknown) =>
      handleServerError(error, t('Failed to delete model parameter')),
  })

  const columns: ColumnDef<CanonicalModel>[] = useMemo(() => {
    return [
      {
        accessorKey: 'canonicalKey',
        header: t('Canonical Key'),
        size: 280,
        minSize: 220,
        enableHiding: false,
        cell: ({ row }) => (
          <div className='flex min-w-0 flex-col gap-0.5 py-1'>
            <span className='truncate font-mono text-sm'>
              {row.original.canonicalKey}
            </span>
            {row.original.displayName &&
              row.original.displayName !== row.original.canonicalKey && (
                <span className='text-muted-foreground truncate text-xs'>
                  {row.original.displayName}
                </span>
              )}
          </div>
        ),
      },
      {
        accessorKey: 'vendor',
        header: t('Vendor'),
        size: 130,
        cell: ({ row }) => (
          <span className='text-sm'>{row.original.vendor || '—'}</span>
        ),
      },
      {
        accessorKey: 'contextLength',
        header: t('Context'),
        size: 100,
        cell: ({ row }) => (
          <span className='text-sm'>{row.original.contextLength ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'maxOutputTokens',
        header: t('Max output'),
        size: 110,
        cell: ({ row }) => (
          <span className='text-sm'>{row.original.maxOutputTokens ?? '—'}</span>
        ),
      },
      {
        id: 'capabilities',
        header: t('Capabilities'),
        size: 220,
        cell: ({ row }) => {
          const badges: string[] = []
          if (row.original.reasoning === true) {
            badges.push(t('Reasoning'))
          }
          if (row.original.toolCall === true) {
            badges.push(t('Tool call'))
          }
          if (row.original.structuredOutput === true) {
            badges.push(t('Structured output'))
          }
          if (row.original.attachment === true) {
            badges.push(t('Attachment'))
          }
          if (badges.length === 0) return <span className='text-sm'>—</span>
          return (
            <div className='flex flex-wrap gap-1'>
              {badges.map((badge) => (
                <span
                  key={badge}
                  className='bg-muted text-muted-foreground inline-flex h-5 w-fit items-center rounded-4xl px-1.5 text-xs leading-none font-medium whitespace-nowrap'
                >
                  {badge}
                </span>
              ))}
            </div>
          )
        },
      },
      {
        accessorKey: 'category',
        header: t('Category'),
        size: 120,
        cell: ({ row }) => (
          <span className='text-sm'>{row.original.category || '—'}</span>
        ),
      },
      {
        accessorKey: 'source',
        header: t('Source'),
        size: 120,
        cell: ({ row }) => (
          <span className='text-sm'>{row.original.source || '—'}</span>
        ),
      },
      {
        accessorKey: 'manualOverride',
        header: t('Manual override'),
        size: 130,
        cell: ({ row }) =>
          row.original.manualOverride ? (
            <span className='text-warning text-xs font-medium'>
              {t('Manual')}
            </span>
          ) : (
            <span className='text-sm'>—</span>
          ),
      },
      {
        accessorKey: 'updatedAt',
        header: t('Updated'),
        size: 160,
        cell: ({ row }) =>
          row.original.updatedAt
            ? formatTimestampToDate(row.original.updatedAt)
            : '—',
      },
      {
        id: 'actions',
        header: t('Actions'),
        enableSorting: false,
        enableHiding: false,
        size: 120,
        cell: ({ row }) => (
          <div className='flex min-w-0 items-center gap-1'>
            <Button
              variant='ghost'
              size='sm'
              className='min-w-0'
              onClick={() => {
                setParameterEditing(row.original)
                setParametersDialog('form')
              }}
            >
              <span className='truncate'>{t('Edit')}</span>
            </Button>
            <Button
              variant='ghost'
              size='sm'
              className='text-destructive min-w-0'
              onClick={() => setDeleteTarget(row.original)}
            >
              <span className='truncate'>{t('Delete')}</span>
            </Button>
          </div>
        ),
      },
    ]
  }, [t, setParameterEditing, setParametersDialog])

  const { table } = useDataTable({
    data: items,
    columns,
    totalCount,
    getRowId: (item) => `parameter:${item.id}`,
    columnFilters,
    pagination,
    globalFilter,
    onColumnFiltersChange,
    onPaginationChange,
    onGlobalFilterChange,
    manualPagination: true,
    manualFiltering: true,
  })

  const hasActiveFilters = Boolean(
    globalFilter?.trim() || vendorFilter || capabilityFilter || sourceFilter
  )
  const isEmptyLibrary = !isLoading && totalCount === 0 && !hasActiveFilters

  if (isError) {
    return (
      <div className='flex flex-col items-center justify-center gap-4 py-12'>
        <p className='text-muted-foreground max-w-md text-center text-sm'>
          {error instanceof Error
            ? error.message
            : t('Failed to load model parameters')}
        </p>
        <Button variant='outline' size='sm' onClick={() => void refetch()}>
          {t('Retry')}
        </Button>
      </div>
    )
  }

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={
          isEmptyLibrary
            ? t('No model parameters yet')
            : t('No model parameters found')
        }
        emptyDescription={
          isEmptyLibrary
            ? t(
                'Sync the library from an external source or add a model manually.'
              )
            : t('No parameters match the current filters. Try adjusting them.')
        }
        emptyAction={
          isEmptyLibrary ? (
            <div className='flex flex-wrap items-center justify-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setParametersDialog('sync')}
              >
                {t('Sync model parameters')}
              </Button>
              <Button size='sm' onClick={() => setParametersDialog('form')}>
                {t('Add model parameter')}
              </Button>
            </div>
          ) : undefined
        }
        skeletonKeyPrefix='model-parameter-skeleton'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Filter by canonical key or display name...'),
          searchDebounceMs: 500,
          filters: [
            {
              columnId: 'vendor',
              title: t('Vendor'),
              options: [
                { label: t('All vendors'), value: 'all' },
                ...vendorOptions,
              ],
              singleSelect: true,
            },
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
            {
              columnId: 'source',
              title: t('Source'),
              options: [
                { label: t('All sources'), value: 'all' },
                ...SOURCE_FILTERS.map((option) => ({
                  label: t(option.label),
                  value: option.value,
                })),
              ],
              singleSelect: true,
            },
          ],
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('Delete model parameter?')}
        desc={t(
          'This removes {{key}} from the library. Channel configuration and routing are not affected.',
          { key: deleteTarget?.canonicalKey ?? '' }
        )}
        confirmText={t('Delete')}
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id)
        }}
      />
    </>
  )
}
