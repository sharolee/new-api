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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { handleServerError } from '@/lib/handle-server-error'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

import {
  createModelParameter,
  getCategories,
  getModelParameters,
  updateModelParameter,
} from '../../api'
import {
  modelCategoriesQueryKeys,
  modelMappingsQueryKeys,
  modelParametersQueryKeys,
} from '../../lib'
import {
  canonicalModelFormSchema,
  type CanonicalModel,
  type CanonicalModelFormValues,
  type CanonicalModelParameterPayload,
  type TriStateBoolean,
} from '../../types'
import { useModels } from '../models-provider'

const EMPTY_VALUES: CanonicalModelFormValues = {
  canonicalKey: '',
  displayName: '',
  vendor: '',
  contextLength: '',
  maxOutputTokens: '',
  inputModalities: '',
  outputModalities: '',
  reasoning: 'unknown',
  reasoningEfforts: '',
  toolCall: 'unknown',
  structuredOutput: 'unknown',
  attachment: 'unknown',
  knowledgeCutoff: '',
  releaseDate: '',
  parameterCount: '',
  category: '',
  tags: '',
  priceInput: '',
  priceOutput: '',
}

const TRI_STATE_OPTIONS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const

function parseIntOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function triStateToBoolean(value: TriStateBoolean): boolean | null {
  if (value === 'yes') return true
  if (value === 'no') return false
  return null
}

function triStateFromBoolean(value: boolean | null): TriStateBoolean {
  if (value == null) return 'unknown'
  return value ? 'yes' : 'no'
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toFormValues(model: CanonicalModel): CanonicalModelFormValues {
  return {
    canonicalKey: model.canonicalKey,
    displayName: model.displayName,
    vendor: model.vendor,
    contextLength:
      model.contextLength != null ? String(model.contextLength) : '',
    maxOutputTokens:
      model.maxOutputTokens != null ? String(model.maxOutputTokens) : '',
    inputModalities: model.inputModalities.join(', '),
    outputModalities: model.outputModalities.join(', '),
    reasoning: triStateFromBoolean(model.reasoning),
    reasoningEfforts: model.reasoningEfforts.join(', '),
    toolCall: triStateFromBoolean(model.toolCall),
    structuredOutput: triStateFromBoolean(model.structuredOutput),
    attachment: triStateFromBoolean(model.attachment),
    knowledgeCutoff: model.knowledgeCutoff ?? '',
    releaseDate: model.releaseDate ?? '',
    parameterCount: model.parameterCount ?? '',
    category: model.category,
    tags: model.tags.join(', '),
    priceInput: model.priceInput != null ? String(model.priceInput) : '',
    priceOutput: model.priceOutput != null ? String(model.priceOutput) : '',
  }
}

function buildPayload(
  values: CanonicalModelFormValues,
  existing: CanonicalModel | null
): CanonicalModelParameterPayload {
  const manualFields = {
    canonicalKey: values.canonicalKey.trim(),
    displayName: values.displayName.trim(),
    vendor: values.vendor.trim(),
    contextLength: parseIntOrNull(values.contextLength),
    maxOutputTokens: parseIntOrNull(values.maxOutputTokens),
    inputModalities: splitCsv(values.inputModalities),
    outputModalities: splitCsv(values.outputModalities),
    reasoning: triStateToBoolean(values.reasoning),
    reasoningEfforts: splitCsv(values.reasoningEfforts),
    toolCall: triStateToBoolean(values.toolCall),
    structuredOutput: triStateToBoolean(values.structuredOutput),
    attachment: triStateToBoolean(values.attachment),
    knowledgeCutoff: emptyToNull(values.knowledgeCutoff),
    releaseDate: emptyToNull(values.releaseDate),
    parameterCount: emptyToNull(values.parameterCount),
    category: values.category.trim(),
    tags: splitCsv(values.tags),
    priceInput: parseIntOrNull(values.priceInput),
    priceOutput: parseIntOrNull(values.priceOutput),
  }
  if (existing) {
    // Manual edits always mark the canonical model as overridden so a later
    // sync cannot silently overwrite the admin's values.
    return {
      ...existing,
      ...manualFields,
      manualOverride: true,
    }
  }
  return {
    ...manualFields,
    source: 'manual',
    sourceId: '',
    manualOverride: false,
    syncTime: null,
  }
}

export function ModelParameterFormDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { parameterEditing } = useModels()
  const editing = parameterEditing != null

  const form = useForm({
    resolver: zodResolver(canonicalModelFormSchema),
    defaultValues: EMPTY_VALUES,
  })

  const save = useMutation({
    mutationFn: async (values: CanonicalModelFormValues) => {
      const payload = buildPayload(values, parameterEditing)
      const response =
        editing && parameterEditing
          ? await updateModelParameter(parameterEditing.id, payload)
          : await createModelParameter(payload)
      if (!response.success) {
        throw createServerError(response, t('Failed to save model parameter'))
      }
      return response
    },
    onSuccess: async () => {
      toast.success(
        editing
          ? t('Model parameter updated successfully')
          : t('Model parameter created successfully')
      )
      await queryClient.invalidateQueries({
        queryKey: modelParametersQueryKeys.lists(),
      })
      await queryClient.invalidateQueries({
        queryKey: modelMappingsQueryKeys.lists(),
      })
      props.onOpenChange(false)
    },
    onError: (error: unknown) =>
      handleServerError(error, t('Failed to save model parameter')),
  })

  // Canonical keys that already exist, used to reject duplicate keys on create.
  const { data: keysData } = useQuery({
    queryKey: modelParametersQueryKeys.list({ page_size: 1000 }),
    queryFn: async () =>
      requireServerSuccess(await getModelParameters({ page_size: 1000 })),
    enabled: props.open && !editing,
  })
  const existingKeys = useMemo(
    () =>
      new Set((keysData?.data?.items ?? []).map((item) => item.canonicalKey)),
    [keysData]
  )

  // Category names offered as datalist suggestions.
  const { data: categoriesData } = useQuery({
    queryKey: modelCategoriesQueryKeys.list(),
    queryFn: () => getCategories(),
    enabled: props.open,
  })
  const categoryNames = useMemo(
    () => (categoriesData?.data ?? []).map((category) => category.name),
    [categoriesData]
  )

  useEffect(() => {
    if (!props.open) return
    form.reset(
      editing && parameterEditing
        ? toFormValues(parameterEditing)
        : EMPTY_VALUES
    )
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, parameterEditing, editing])

  const handleSubmit = (values: CanonicalModelFormValues) => {
    if (!editing) {
      const key = values.canonicalKey.trim()
      if (existingKeys.has(key)) {
        form.setError('canonicalKey', {
          type: 'manual',
          message: t('This canonical key already exists'),
        })
        return
      }
    }
    save.mutate(values)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !save.isPending && props.onOpenChange(open)}
      title={editing ? t('Edit model parameter') : t('Add model parameter')}
      description={t(
        'Parameters stored here are metadata only. Channels, routing and billing are not affected.'
      )}
      contentClassName='sm:max-w-3xl'
      contentHeight='min(70vh, 720px)'
      footer={
        <>
          <Button
            variant='outline'
            disabled={save.isPending}
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form='model-parameter-form'
            disabled={save.isPending}
          >
            {save.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      {editing && parameterEditing && !parameterEditing.manualOverride && (
        <p className='text-warning text-sm'>
          {t('Manual override will be enabled for this model on save.')}
        </p>
      )}
      {save.isError && (
        <ErrorState
          description={
            save.error instanceof Error
              ? save.error.message
              : t('Failed to save model parameter')
          }
        />
      )}
      <Form {...form}>
        <form
          id='model-parameter-form'
          className='space-y-5'
          onSubmit={form.handleSubmit(handleSubmit)}
        >
          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='canonicalKey'
              render={({ field }) => (
                <FormItem className='sm:col-span-2'>
                  <FormLabel required>{t('Canonical Key')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={editing}
                      placeholder='e.g. deepseek/deepseek-v3'
                      aria-disabled={editing || undefined}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='displayName'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Display Name')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('DeepSeek V3')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='vendor'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Vendor')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('DeepSeek')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <fieldset className='space-y-3'>
            <legend className='text-sm font-medium'>{t('Limits')}</legend>
            <div className='grid gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='contextLength'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Context Length')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode='numeric'
                        placeholder='128000'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='maxOutputTokens'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Max Output Tokens')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode='numeric'
                        placeholder='8192'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </fieldset>

          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='inputModalities'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Input Modalities')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='text, image' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='outputModalities'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Output Modalities')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='text' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <fieldset className='space-y-3'>
            <legend className='text-sm font-medium'>{t('Capabilities')}</legend>
            <div className='grid gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='reasoning'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Reasoning')}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        items={TRI_STATE_OPTIONS.map((option) => ({
                          value: option.value,
                          label: t(option.label),
                        }))}
                        onValueChange={(value) =>
                          field.onChange(value ?? 'unknown')
                        }
                      >
                        <SelectTrigger
                          className='w-full'
                          aria-label={t('Reasoning')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRI_STATE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='reasoningEfforts'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Reasoning Efforts')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder='high, medium, low' />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='toolCall'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Tool Call')}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        items={TRI_STATE_OPTIONS.map((option) => ({
                          value: option.value,
                          label: t(option.label),
                        }))}
                        onValueChange={(value) =>
                          field.onChange(value ?? 'unknown')
                        }
                      >
                        <SelectTrigger
                          className='w-full'
                          aria-label={t('Tool Call')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRI_STATE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='structuredOutput'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Structured Output')}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        items={TRI_STATE_OPTIONS.map((option) => ({
                          value: option.value,
                          label: t(option.label),
                        }))}
                        onValueChange={(value) =>
                          field.onChange(value ?? 'unknown')
                        }
                      >
                        <SelectTrigger
                          className='w-full'
                          aria-label={t('Structured Output')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRI_STATE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='attachment'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Attachment')}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        items={TRI_STATE_OPTIONS.map((option) => ({
                          value: option.value,
                          label: t(option.label),
                        }))}
                        onValueChange={(value) =>
                          field.onChange(value ?? 'unknown')
                        }
                      >
                        <SelectTrigger
                          className='w-full'
                          aria-label={t('Attachment')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRI_STATE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </fieldset>

          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='knowledgeCutoff'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Knowledge Cutoff')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='2024-07' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='releaseDate'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Release Date')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='2024-12-26' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='parameterCount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Parameter Count')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='671B' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='category'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Category')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      list='model-parameter-category-options'
                      placeholder={t('e.g. Text generation')}
                    />
                  </FormControl>
                  <datalist id='model-parameter-category-options'>
                    {categoryNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='tags'
              render={({ field }) => (
                <FormItem className='sm:col-span-2'>
                  <FormLabel>{t('Tags')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('chat, coding')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <fieldset className='space-y-3'>
            <legend className='text-sm font-medium'>{t('Pricing')}</legend>
            <div className='grid gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='priceInput'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Input price (per 1M tokens)')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode='decimal'
                        placeholder='0.27'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='priceOutput'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Output price (per 1M tokens)')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode='decimal'
                        placeholder='1.10'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </fieldset>
        </form>
      </Form>
    </Dialog>
  )
}
