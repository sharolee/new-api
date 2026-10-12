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
import { Combobox } from '@/components/ui/combobox'
import type { ComboboxInputOption } from '@/components/ui/combobox-input'
import { Label } from '@/components/ui/label'
import { useDebounce, useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { handleServerError } from '@/lib/handle-server-error'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

import {
  clearModelMapping,
  getModelMappings,
  getModelParameters,
  setModelMapping,
} from '../api'
import { DEFAULT_PAGE_SIZE } from '../constants'
import { modelMappingsQueryKeys, modelParametersQueryKeys } from '../lib'
import type { GetModelMappingsParams, ModelMappingRow } from '../types'

const route = getRouteApi('/_authenticated/models/$section')

function firstFilter(
  columnFilters: { id: string; value: unknown }[],
  id: string
) {
  const raw = columnFilters.find((filter) => filter.id === id)?.value
  const values = Array.isArray(raw) ? (raw as string[]) : []
  return values.length > 0 && values[0] !== 'all' ? values[0] : undefined
}

export function ModelMappingsView() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [assignTarget, setAssignTarget] = useState<ModelMappingRow | null>(null)
  const [canonicalChoice, setCanonicalChoice] = useState<string>('')
  const [assignSearch, setAssignSearch] = useState('')
  const [clearTarget, setClearTarget] = useState<ModelMappingRow | null>(null)

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
      pageKey: 'mPage',
      pageSizeKey: 'mPageSize',
    },
    globalFilter: { enabled: true, key: 'mFilter' },
    columnFilters: [
      { columnId: 'status', searchKey: 'mStatus', type: 'array' },
    ],
  })

  const statusFilter = firstFilter(columnFilters, 'status')

  const queryParams: GetModelMappingsParams = {
    keyword: globalFilter?.trim() || undefined,
    status: (statusFilter as GetModelMappingsParams['status']) || 'all',
    page: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  }

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: modelMappingsQueryKeys.list(queryParams),
    queryFn: async () =>
      requireServerSuccess(await getModelMappings(queryParams)),
  })

  const items = data?.data?.items ?? []
  const totalCount = data?.data?.total ?? 0

  // Canonical models for manual assignment, searched on the server so models
  // beyond the first page of the catalog remain selectable.
  const assignKeyword = useDebounce(assignSearch, 250).trim()
  const { data: canonicalData } = useQuery({
    queryKey: modelParametersQueryKeys.assignOptions(
      assignKeyword || undefined
    ),
    queryFn: async () =>
      requireServerSuccess(
        await getModelParameters({
          keyword: assignKeyword || undefined,
          page_size: 50,
        })
      ),
    enabled: assignTarget !== null,
  })
  const canonicalOptions: ComboboxInputOption[] = useMemo(() => {
    const options = (canonicalData?.data?.items ?? []).map((item) => ({
      value: String(item.id),
      label: item.canonicalKey,
      description: item.displayName || undefined,
    }))
    // Keep the current mapping visible even when it is outside the search page.
    const presetId = assignTarget?.canonicalId
    const presetKey = assignTarget?.canonicalKey
    if (presetId == null || !presetKey) return options
    const presetValue = String(presetId)
    if (options.some((option) => option.value === presetValue)) return options
    return [
      {
        value: presetValue,
        label: presetKey,
        description: assignTarget?.displayName || undefined,
      },
      ...options,
    ]
  }, [canonicalData?.data?.items, assignTarget])

  const assign = useMutation({
    mutationFn: async (target: ModelMappingRow) => {
      const response = await setModelMapping({
        model: target.model,
        canonicalId: Number(canonicalChoice),
      })
      if (!response.success) {
        throw createServerError(response, t('Failed to assign mapping'))
      }
      return response
    },
    onSuccess: async () => {
      toast.success(t('Mapping assigned'))
      setAssignTarget(null)
      setCanonicalChoice('')
      setAssignSearch('')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: modelMappingsQueryKeys.lists(),
        }),
        queryClient.invalidateQueries({
          queryKey: modelParametersQueryKeys.assignOptionsRoot(),
        }),
      ])
    },
    onError: (error: unknown) =>
      handleServerError(error, t('Failed to assign mapping')),
  })

  const clear = useMutation({
    mutationFn: async (model: string) => {
      const response = await clearModelMapping(model)
      if (!response.success) {
        throw createServerError(response, t('Failed to clear mapping'))
      }
      return response
    },
    onSuccess: async () => {
      toast.success(t('Mapping cleared'))
      setClearTarget(null)
      await queryClient.invalidateQueries({
        queryKey: modelMappingsQueryKeys.lists(),
      })
    },
    onError: (error: unknown) =>
      handleServerError(error, t('Failed to clear mapping')),
  })

  const columns: ColumnDef<ModelMappingRow>[] = useMemo(() => {
    return [
      {
        accessorKey: 'channelName',
        header: t('Channel'),
        size: 180,
        cell: ({ row }) => (
          <div className='flex min-w-0 flex-col'>
            <span className='truncate text-sm'>{row.original.channelName}</span>
            <span className='text-muted-foreground text-xs'>
              #{row.original.channelId}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'model',
        header: t('Model'),
        size: 240,
        minSize: 180,
        enableHiding: false,
        cell: ({ row }) => (
          <div className='flex min-w-0 flex-col gap-0.5'>
            <span className='truncate font-mono text-sm'>
              {row.original.model}
            </span>
            {row.original.declaredModel &&
              row.original.declaredModel !== row.original.model && (
                <span className='text-muted-foreground truncate text-xs'>
                  {row.original.declaredModel}
                </span>
              )}
          </div>
        ),
      },
      {
        accessorKey: 'matched',
        header: t('Matched'),
        size: 100,
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
        cell: ({ row }) => (
          <div className='flex min-w-0 flex-col'>
            {row.original.canonicalKey ? (
              <>
                <span className='truncate font-mono text-sm'>
                  {row.original.canonicalKey}
                </span>
                {row.original.displayName && (
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
        accessorKey: 'origin',
        header: t('Origin'),
        size: 100,
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
      {
        accessorKey: 'confidence',
        header: t('Confidence'),
        size: 100,
        cell: ({ row }) => (
          <span className='text-sm'>
            {row.original.confidence != null
              ? `${Math.round(row.original.confidence * 100)}%`
              : '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: t('Actions'),
        enableSorting: false,
        enableHiding: false,
        size: 160,
        cell: ({ row }) => (
          <div className='flex min-w-0 items-center gap-1'>
            <Button
              variant='ghost'
              size='sm'
              className='min-w-0'
              onClick={() => {
                setCanonicalChoice(
                  row.original.canonicalId != null
                    ? String(row.original.canonicalId)
                    : ''
                )
                setAssignSearch('')
                setAssignTarget(row.original)
              }}
            >
              <span className='truncate'>{t('Assign')}</span>
            </Button>
            {row.original.origin === 'manual' && (
              <Button
                variant='ghost'
                size='sm'
                className='text-destructive min-w-0'
                onClick={() => setClearTarget(row.original)}
              >
                <span className='truncate'>{t('Clear')}</span>
              </Button>
            )}
          </div>
        ),
      },
    ]
  }, [t])

  const { table } = useDataTable({
    data: items,
    columns,
    totalCount,
    getRowId: (item) => `mapping:${item.channelId}:${item.model}`,
    columnFilters,
    pagination,
    globalFilter,
    onColumnFiltersChange,
    onPaginationChange,
    onGlobalFilterChange,
    manualPagination: true,
    manualFiltering: true,
  })

  const UNMATCHED_ROW_CLASS =
    '[--data-table-card-bg:var(--table-disabled)] hover:[--data-table-card-bg:var(--table-disabled-hover)] data-[state=selected]:![--data-table-card-bg:var(--table-disabled)] data-[state=selected]:hover:![--data-table-card-bg:var(--table-disabled-hover)] [background-color:var(--table-disabled)] hover:[background-color:var(--table-disabled-hover)] [&>td:first-child]:[border-left-color:var(--warning)] [&>td:first-child]:border-l-4 [&>td:first-child]:pl-1'

  if (isError) {
    return (
      <div className='flex flex-col items-center justify-center gap-4 py-12'>
        <p className='text-muted-foreground max-w-md text-center text-sm'>
          {error instanceof Error
            ? error.message
            : t('Failed to load model mappings')}
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
        emptyTitle={t('No model mappings found')}
        emptyDescription={t(
          'No channel model names to resolve. Mappings appear here once channels declare models.'
        )}
        skeletonKeyPrefix='model-mapping-skeleton'
        applyHeaderSize
        getRowClassName={(row) =>
          !row.original.matched ? UNMATCHED_ROW_CLASS : undefined
        }
        toolbarProps={{
          searchPlaceholder: t('Filter by model name...'),
          searchDebounceMs: 500,
          filters: [
            {
              columnId: 'status',
              title: t('Match status'),
              options: [
                { label: t('All'), value: 'all' },
                { label: t('Matched'), value: 'matched' },
                { label: t('Unmatched'), value: 'unmatched' },
              ],
              singleSelect: true,
            },
          ],
        }}
      />

      <ConfirmDialog
        open={assignTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAssignTarget(null)
            setAssignSearch('')
          }
        }}
        title={t('Assign canonical model')}
        desc={t(
          'Map {{model}} to a canonical model. Manual mappings always take precedence over auto-suggested ones.',
          { model: assignTarget?.model ?? '' }
        )}
        confirmText={t('Assign')}
        disabled={!canonicalChoice}
        isLoading={assign.isPending}
        handleConfirm={() => {
          if (assignTarget) assign.mutate(assignTarget)
        }}
      >
        <div className='space-y-1'>
          <Label className='text-sm'>{t('Canonical model')}</Label>
          <Combobox
            options={canonicalOptions}
            value={canonicalChoice || null}
            onValueChange={(value) => {
              setCanonicalChoice(value ?? '')
              setAssignSearch('')
            }}
            onSearchChange={setAssignSearch}
            placeholder={t('Search canonical models...')}
            searchPlaceholder={t('Search canonical models...')}
            aria-label={t('Canonical model')}
            className='w-full'
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={clearTarget !== null}
        onOpenChange={(open) => {
          if (!open) setClearTarget(null)
        }}
        title={t('Clear mapping?')}
        desc={t(
          'Remove the manual mapping for {{model}}. The model will be resolved by auto-suggested aliases or marked unmatched.',
          { model: clearTarget?.model ?? '' }
        )}
        confirmText={t('Clear')}
        destructive
        isLoading={clear.isPending}
        handleConfirm={() => {
          if (clearTarget) clear.mutate(clearTarget.model)
        }}
      />
    </>
  )
}
