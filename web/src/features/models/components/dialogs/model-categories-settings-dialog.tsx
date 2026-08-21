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
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import {
  createCategory,
  deleteCategory,
  getCategories,
  updateCategory,
} from '../../api'
import {
  availableModelsQueryKeys,
  modelCategoriesQueryKeys,
} from '../../lib'
import type { ModelCategory } from '../../types'

type ModelCategoriesSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CATEGORY_FORM_ID = 'model-category-form'

const categoryFormSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(255),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sort_order: z.coerce.number().int().min(0),
})

type CategoryFormValues = z.infer<typeof categoryFormSchema>

const DEFAULT_FORM_VALUES: CategoryFormValues = {
  name: '',
  description: '',
  color: '#6366F1',
  sort_order: 0,
}

export function ModelCategoriesSettingsDialog(
  props: ModelCategoriesSettingsDialogProps
) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ModelCategory | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const categoriesQuery = useQuery({
    queryKey: modelCategoriesQueryKeys.list(),
    queryFn: getCategories,
    enabled: props.open,
  })
  const categories = categoriesQuery.data?.data || []

  const form = useForm({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: DEFAULT_FORM_VALUES,
  })

  const invalidateCaches = () => {
    queryClient.invalidateQueries({ queryKey: modelCategoriesQueryKeys.all })
    queryClient.invalidateQueries({ queryKey: availableModelsQueryKeys.all })
  }

  const startEdit = (category: ModelCategory) => {
    setEditing(category)
    setConfirmDeleteId(null)
    form.reset({
      name: category.name,
      description: category.description || '',
      color: category.color || '#6366F1',
      sort_order: category.sort_order || 0,
    })
  }

  const cancelEdit = () => {
    setEditing(null)
    form.reset(DEFAULT_FORM_VALUES)
  }

  const onSubmit = async (values: CategoryFormValues) => {
    setIsSaving(true)
    try {
      const payload = {
        name: values.name.trim(),
        description: values.description.trim(),
        color: values.color,
        sort_order: values.sort_order,
      }
      const response = editing
        ? await updateCategory(editing.id, payload)
        : await createCategory(payload)

      if (response.success) {
        toast.success(t(editing ? 'Category updated' : 'Category created'))
        invalidateCaches()
        cancelEdit()
      } else {
        toast.error(response.message || t('Operation failed'))
      }
    } catch (error: unknown) {
      toast.error((error as Error)?.message || t('Operation failed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    setDeletingId(id)
    try {
      const response = await deleteCategory(id)
      if (response.success) {
        toast.success(t('Category deleted'))
        if (editing?.id === id) {
          cancelEdit()
        }
        setConfirmDeleteId(null)
        invalidateCaches()
      } else {
        toast.error(response.message || t('Operation failed'))
      }
    } catch (error: unknown) {
      toast.error((error as Error)?.message || t('Operation failed'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Manage model categories')}
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <Button
          type='button'
          variant='outline'
          onClick={() => props.onOpenChange(false)}
        >
          {t('Close')}
        </Button>
      }
    >
      <Form {...form}>
        <form
          id={CATEGORY_FORM_ID}
          onSubmit={form.handleSubmit(onSubmit)}
          className='space-y-3'
        >
          <div className='flex items-start gap-2'>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem className='flex-1'>
                  <FormLabel>{t('Category name')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('Reasoning')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='color'
              render={({ field }) => (
                <FormItem className='w-16'>
                  <FormLabel>{t('Color')}</FormLabel>
                  <FormControl>
                    <Input type='color' className='h-9 p-1' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='sort_order'
              render={({ field }) => (
                <FormItem className='w-24'>
                  <FormLabel>{t('Sort order')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      step={1}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={
                        field.value === undefined || field.value === null
                          ? ''
                          : String(field.value)
                      }
                      onChange={(event) => field.onChange(event.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name='description'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Description')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className='flex justify-end gap-2'>
            {editing ? (
              <Button type='button' variant='outline' onClick={cancelEdit}>
                {t('Cancel')}
              </Button>
            ) : null}
            <Button type='submit' disabled={isSaving}>
              {isSaving ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : null}
              {editing ? t('Save') : t('New category')}
            </Button>
          </div>
        </form>
      </Form>

      <div className='space-y-2'>
        {categoriesQuery.isLoading ? (
          <div className='flex items-center justify-center py-6'>
            <Loader2 className='h-4 w-4 animate-spin' />
          </div>
        ) : null}
        {!categoriesQuery.isLoading && categories.length === 0 ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>
            {t('No categories yet')}
          </p>
        ) : null}
        {!categoriesQuery.isLoading && categories.length > 0
          ? categories.map((category) => (
            <div
              key={category.id}
              className='flex items-center gap-3 rounded-md border px-3 py-2'
            >
              <span
                className='h-3 w-3 shrink-0 rounded-full'
                style={{ backgroundColor: category.color }}
              />
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <span className='truncate text-sm font-medium'>
                    {t(category.name)}
                  </span>
                  <span className='shrink-0 text-xs text-muted-foreground'>
                    #{category.sort_order ?? 0}
                  </span>
                </div>
                {category.description ? (
                  <p className='truncate text-xs text-muted-foreground'>
                    {category.description}
                  </p>
                ) : null}
              </div>
              {confirmDeleteId === category.id ? (
                <>
                  <span className='hidden truncate text-xs text-muted-foreground sm:inline'>
                    {t(
                      'Delete this category? It will be removed from all models.'
                    )}
                  </span>
                  <Button
                    type='button'
                    variant='destructive'
                    size='sm'
                    disabled={deletingId === category.id}
                    onClick={() => handleDelete(category.id)}
                  >
                    {deletingId === category.id ? (
                      <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                    ) : null}
                    {t('Confirm')}
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    {t('Cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label={t('Edit')}
                    onClick={() => startEdit(category)}
                  >
                    <Pencil className='h-4 w-4' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label={t('Delete')}
                    onClick={() => setConfirmDeleteId(category.id)}
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </>
              )}
            </div>
          ))
          : null}
      </div>
    </Dialog>
  )
}
