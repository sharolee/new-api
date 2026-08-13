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
import type { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { ProviderBadge } from '@/components/provider-badge'
import { TableId } from '@/components/table-id'
import { GroupBadge } from '@/components/group-badge'
import { getLobeIcon } from '@/lib/lobe-icon'

import type { AvailableModel } from '../types'

function getCategoryIcon(iconKey: string) {
  return getLobeIcon(
    `${iconKey.split('.')[0]}.Avatar.type={'platform'}`,
    20
  )
}

/**
 * Generate available models columns configuration
 */
export function useAvailableModelsColumns(): ColumnDef<AvailableModel>[] {
  const { t } = useTranslation()

  return [
    {
      id: 'row_index',
      header: t('ID'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const idx = row.index + 1
        return <TableId value={idx} />
      },
      size: 56,
      enableSorting: false,
    },

    {
      accessorKey: 'model_name',
      header: t('Model Name'),
      meta: { mobileTitle: true },
      cell: ({ row }) => {
        const name = row.getValue('model_name') as string
        const firstChar = name[0] || 'M'
        const icon = getCategoryIcon(firstChar)

        return (
          <div className='flex max-w-full min-w-0 items-center gap-2'>
            <div className='flex size-5 shrink-0 items-center justify-center overflow-hidden'>
              {icon}
            </div>
            <span className='truncate font-mono text-sm'>{name}</span>
          </div>
        )
      },
      size: 280,
      minSize: 180,
    },

    {
      id: 'channel_count',
      header: t('Channels'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const count = row.original.channel_count
        return (
          <div className='flex items-center justify-center'>
            <span className='inline-flex items-center rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'>
              {count}
            </span>
          </div>
        )
      },
      size: 80,
      enableSorting: true,
    },

    {
      id: 'channel_names',
      header: t('Channel Names'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const names = row.original.channel_names ?? []
        return (
          <div className='flex max-w-full flex-wrap gap-1'>
            {names.slice(0, 5).map((name) => (
              <ProviderBadge
                key={name}
                label={name}
                size='sm'
                variant='neutral'
              />
            ))}
            {names.length > 5 && (
              <span className='shrink-0 text-xs text-muted-foreground'>
                +{names.length - 5}
              </span>
            )}
          </div>
        )
      },
      size: 220,
      minSize: 140,
    },

    {
      id: 'enabled_groups',
      header: t('Enabled Groups'),
      cell: ({ row }) => {
        const groups = row.original.enabled_groups ?? []
        if (groups.length === 0) {
          return (
            <span className='text-xs text-muted-foreground'>
              {t('None')}
            </span>
          )
        }
        return (
          <div className='flex max-w-full flex-wrap gap-1'>
            {groups.slice(0, 4).map((group) => (
              <GroupBadge key={group} group={group} size='sm' />
            ))}
            {groups.length > 4 && (
              <span className='shrink-0 text-xs text-muted-foreground'>
                +{groups.length - 4}
              </span>
            )}
          </div>
        )
      },
      size: 200,
      minSize: 120,
    },

    {
      id: 'categories',
      header: t('Categories'),
      cell: ({ row }) => {
        const categories = row.original.categories ?? []
        if (categories.length === 0) {
          return (
            <span className='text-xs text-muted-foreground'>
              {t('Uncategorized')}
            </span>
          )
        }
        return (
          <div className='flex max-w-full flex-wrap gap-1'>
            {categories.slice(0, 4).map((cat) => (
              <span
                key={cat.id}
                className='inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium'
                style={{
                  backgroundColor: `${cat.color}22`,
                  color: cat.color,
                }}
              >
                <span
                  className='inline-block size-1.5 rounded-full'
                  style={{ backgroundColor: cat.color }}
                />
                {cat.name}
              </span>
            ))}
            {categories.length > 4 && (
              <span className='shrink-0 text-xs text-muted-foreground'>
                +{categories.length - 4}
              </span>
            )}
          </div>
        )
      },
      size: 180,
      minSize: 120,
    },

    {
      id: 'has_model_meta',
      header: t('Has Meta'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const hasMeta = row.original.has_model_meta
        return hasMeta ? (
          <span className='inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400'>
            {t('Yes')}
          </span>
        ) : (
          <span className='inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400'>
            {t('No')}
          </span>
        )
      },
      size: 70,
      enableSorting: true,
    },
  ]
}