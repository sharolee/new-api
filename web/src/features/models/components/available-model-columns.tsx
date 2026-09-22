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

import { TableId } from '@/components/table-id'
import { GroupBadge } from '@/components/group-badge'
import { getLobeIcon } from '@/lib/lobe-icon'

import type { AvailableModel, ModelCategory } from '../types'
import { CategoryCellEditor } from './category-cell-editor'

function getCategoryIcon(iconKey: string) {
  return getLobeIcon(
    `${iconKey.split('.')[0]}.Avatar.type={'platform'}`,
    20
  )
}

function formatPricingCell(model: AvailableModel, t: (key: string) => string) {
  if (model.quota_type === 1) {
    if ((model.model_price ?? 0) <= 0) {
      return t('Free price')
    }
    return `${t('Per-request')} ${model.model_price}`
  }
  if ((model.model_ratio ?? 0) <= 0) {
    return t('Free price')
  }
  return `${t('Per token')} ${model.model_ratio}`
}

/**
 * Generate available models columns configuration
 */
export function useAvailableModelsColumns(opts?: {
  categories?: ModelCategory[]
}): ColumnDef<AvailableModel>[] {
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
      id: 'channel_names',
      header: t('Channel'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const mappings = row.original.channel_mappings ?? []
        const names = row.original.channel_names ?? []

        // Fallback: when the backend does not provide per-channel mappings,
        // render plain channel names one per line.
        if (mappings.length === 0) {
          if (names.length === 0) {
            return (
              <span className='text-xs text-muted-foreground'>{t('None')}</span>
            )
          }
          return (
            <div className='flex max-w-full flex-col gap-0.5'>
              {names.slice(0, 5).map((name) => (
                <span
                  key={name}
                  className='truncate font-mono text-xs leading-5'
                >
                  {name}
                </span>
              ))}
              {names.length > 5 && (
                <span className='shrink-0 text-xs text-muted-foreground'>
                  +{names.length - 5}
                </span>
              )}
            </div>
          )
        }

        // One line per channel: "channelName" + " : mappedModel" when the
        // channel's model_mapping remaps this model to an upstream name.
        return (
          <div className='flex max-w-full flex-col gap-0.5'>
            {mappings.slice(0, 5).map((m) => (
              <span
                key={m.channel_id}
                className='truncate font-mono text-xs leading-5'
              >
                {m.name}
                {m.mapped_model ? (
                  <span className='text-muted-foreground'>: {m.mapped_model}</span>
                ) : null}
              </span>
            ))}
            {mappings.length > 5 && (
              <span className='shrink-0 text-xs text-muted-foreground'>
                +{mappings.length - 5}
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
      cell: ({ row }) => (
        <CategoryCellEditor
          model={row.original}
          categories={opts?.categories ?? []}
        />
      ),
      size: 180,
      minSize: 120,
    },

    {
      id: 'pricing',
      header: t('Pricing'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const text = formatPricingCell(row.original, t)
        return (
          <span className='inline-flex items-center rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-medium text-primary'>
            {text}
          </span>
        )
      },
      size: 130,
      minSize: 100,
    },

    {
      id: 'tags',
      header: t('Tags'),
      cell: ({ row }) => {
        const tags = row.original.tags ?? []
        if (tags.length === 0) {
          return (
            <span className='text-xs text-muted-foreground'>{t('None')}</span>
          )
        }
        return (
          <div className='flex max-w-full flex-wrap gap-1'>
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className='inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground'
              >
                {tag}
              </span>
            ))}
            {tags.length > 4 && (
              <span className='shrink-0 text-xs text-muted-foreground'>
                +{tags.length - 4}
              </span>
            )}
          </div>
        )
      },
      size: 160,
      minSize: 100,
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