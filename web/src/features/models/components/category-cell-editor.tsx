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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { assignCategories } from '../api'
import { availableModelsQueryKeys } from '../lib'
import type { AvailableModel, ModelCategory } from '../types'

type CategoryCellEditorProps = {
  model: AvailableModel
  categories: ModelCategory[]
}

/**
 * Inline editor for the categories of an available model. Renders the current
 * assigned categories as colored badges; clicking opens a multi-select menu.
 */
export function CategoryCellEditor(props: CategoryCellEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedIds, setSelectedIds] = React.useState<number[]>(() =>
    (props.model.categories ?? []).map((cat) => cat.id)
  )

  const mutation = useMutation({
    mutationFn: (categoryIds: number[]) =>
      assignCategories(props.model.model_name, { category_ids: categoryIds }),
    onMutate: (categoryIds) => {
      setSelectedIds(categoryIds)
      return { previous: props.model.categories ?? [] }
    },
    onError: (error, _variables, context) => {
      setSelectedIds((context?.previous ?? []).map((cat) => cat.id))
      const message =
        error instanceof Error ? error.message : t('Something went wrong')
      toast.error(message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: availableModelsQueryKeys.all,
      })
    },
  })

  const toggle = React.useCallback(
    (categoryId: number) => {
      const next = selectedIds.includes(categoryId)
        ? selectedIds.filter((id) => id !== categoryId)
        : [...selectedIds, categoryId]
      mutation.mutate(next)
    },
    [selectedIds, mutation]
  )

  const selectedCategories = props.categories.filter((cat) =>
    selectedIds.includes(cat.id)
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex max-w-full cursor-pointer flex-wrap items-center gap-1 rounded-md px-1 py-0.5 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
          mutation.isPending && 'opacity-60'
        )}
        aria-label={t('Edit categories')}
      >
        {selectedCategories.length === 0 ? (
          <span className='text-xs text-muted-foreground'>
            {t('Uncategorized')}
          </span>
        ) : (
          <>
            {selectedCategories.slice(0, 4).map((cat) => (
              <span
                key={cat.id}
                className='inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium'
                style={{
                  backgroundColor: `${cat.color}22`,
                  color: cat.color,
                }}
              >
                <span
                  className='inline-block size-1.5 rounded-full'
                  style={{ backgroundColor: cat.color }}
                />
                {t(cat.name)}
              </span>
            ))}
            {selectedCategories.length > 4 && (
              <span className='shrink-0 text-xs text-muted-foreground'>
                +{selectedCategories.length - 4}
              </span>
            )}
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-52'>
        {props.categories.length === 0 ? (
          <DropdownMenuLabel>{t('No categories yet')}</DropdownMenuLabel>
        ) : (
          props.categories.map((cat) => (
            <DropdownMenuCheckboxItem
              key={cat.id}
              checked={selectedIds.includes(cat.id)}
              onCheckedChange={() => toggle(cat.id)}
              disabled={mutation.isPending}
            >
              <span
                className='inline-block size-2 shrink-0 rounded-full'
                style={{ backgroundColor: cat.color }}
              />
              <span className='truncate'>{t(cat.name)}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
