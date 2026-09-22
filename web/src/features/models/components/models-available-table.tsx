/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR a particular purpose. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { getAvailableModels, getCategories, getAvailableChannels } from '../api'
import { DEFAULT_PAGE_SIZE } from '../constants'
import { availableModelsQueryKeys, modelCategoriesQueryKeys, availableChannelsQueryKeys } from '../lib'
import { useAvailableModelsColumns } from './available-model-columns'
import { ModelCategoriesSettingsDialog } from './dialogs/model-categories-settings-dialog'

const route = getRouteApi('/_authenticated/models/$section')

export function ModelsAvailableTable() {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [settingsOpen, setSettingsOpen] = useState(false)

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
    },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      { columnId: 'enabled_groups', searchKey: 'group', type: 'array' },
      { columnId: 'categories', searchKey: 'category_id', type: 'array' },
      { columnId: 'channel_names', searchKey: 'channel_id', type: 'array' },
    ],
  })

  const groupFilter =
    (columnFilters.find((f) => f.id === 'enabled_groups')?.value as string[]) ||
    []
  const categoryFilter =
    (columnFilters.find((f) => f.id === 'categories')?.value as string[]) || []
  const channelFilter =
    (columnFilters.find((f) => f.id === 'channel_names')?.value as string[]) ||
    []

  const { data: categoriesData } = useQuery({
    queryKey: modelCategoriesQueryKeys.list(),
    queryFn: () => getCategories(),
  })

  const { data: channelsData } = useQuery({
    queryKey: availableChannelsQueryKeys.list(),
    queryFn: () => getAvailableChannels(),
  })

  const categories = useMemo(
    () => categoriesData?.data || [],
    [categoriesData?.data]
  )
  const channels = useMemo(
    () => channelsData?.data || [],
    [channelsData?.data]
  )

  const categoryOptions = useMemo(() => {
    return [
      { label: t('All categories'), value: 'all' },
      ...categories.map((c) => ({
        label: t(c.name),
        value: String(c.id),
      })),
    ]
  }, [categories, t])

  const channelOptions = useMemo(() => {
    return [
      { label: t('All channels'), value: 'all' },
      ...channels.map((ch) => ({ label: ch.name, value: String(ch.id) })),
    ]
  }, [channels, t])

  const queryParams: Record<string, string | number> = {
    p: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  }

  if (globalFilter?.trim()) {
    queryParams.keyword = globalFilter.trim()
  }
  if (groupFilter.length > 0 && groupFilter[0] !== 'all') {
    queryParams.group = groupFilter[0]
  }
  if (categoryFilter.length > 0 && categoryFilter[0] !== 'all') {
    queryParams.category_id = categoryFilter[0]
  }
  if (channelFilter.length > 0 && channelFilter[0] !== 'all') {
    queryParams.channel_id = channelFilter[0]
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: availableModelsQueryKeys.list(queryParams),
    queryFn: () => getAvailableModels(queryParams),
  })

  const models = data?.data?.items || []
  const totalCount = data?.data?.total || 0

  const columns = useAvailableModelsColumns({ categories })

  const { table } = useDataTable({
    data: models,
    columns,
    totalCount,
    columnFilters,
    pagination,
    globalFilter,
    onColumnFiltersChange,
    onPaginationChange,
    onGlobalFilterChange,
    manualPagination: true,
    manualFiltering: true,
  })

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No available models found')}
        emptyDescription={t(
          'No models match the current filters. Try adjusting your search criteria.'
        )}
        skeletonKeyPrefix='available-model-skeleton'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Filter by model name...'),
          filters: [
            {
              columnId: 'enabled_groups',
              title: t('Group'),
              options: [{ label: t('All groups'), value: 'all' }],
              singleSelect: true,
            },
            {
              columnId: 'categories',
              title: t('Category'),
              options: categoryOptions,
              singleSelect: true,
            },
            {
              columnId: 'channel_names',
              title: t('Channel'),
              options: channelOptions,
              singleSelect: true,
            },
          ],
          preActions: (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className='h-4 w-4' />
              {t('Settings')}
            </Button>
          ),
        }}
      />
      <ModelCategoriesSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </>
  )
}