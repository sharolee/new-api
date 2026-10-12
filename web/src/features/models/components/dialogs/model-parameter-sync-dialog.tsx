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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { handleServerError } from '@/lib/handle-server-error'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

import { getModelParameterSources, syncModelParameters } from '../../api'
import { modelMappingsQueryKeys, modelParametersQueryKeys } from '../../lib'
import type { ModelParameterSyncResult } from '../../types'

export function ModelParameterSyncDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dryRun, setDryRun] = useState(true)
  const [results, setResults] = useState<ModelParameterSyncResult[] | null>(
    null
  )

  const {
    data: sourcesData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: modelParametersQueryKeys.sources(),
    queryFn: async () => requireServerSuccess(await getModelParameterSources()),
    enabled: props.open,
  })

  const sources = sourcesData?.data ?? []

  const run = useMutation({
    mutationFn: async () => {
      const response = await syncModelParameters({
        sources: [...selected],
        dryRun,
      })
      if (!response.success || !response.data) {
        throw createServerError(response, t('Model parameter sync failed'))
      }
      return response.data
    },
    onSuccess: async (data) => {
      setResults(data.results)
      if (!data.dryRun) {
        toast.success(t('Model parameter sync completed'))
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: modelParametersQueryKeys.lists(),
          }),
          queryClient.invalidateQueries({
            queryKey: modelMappingsQueryKeys.lists(),
          }),
        ])
      }
    },
    onError: (error: unknown) =>
      handleServerError(error, t('Model parameter sync failed')),
  })

  useEffect(() => {
    if (props.open) {
      setSelected(new Set())
      setDryRun(true)
      setResults(null)
      run.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open])

  const enabledSources = useMemo(
    () => (sourcesData?.data ?? []).filter((source) => source.enabled),
    [sourcesData?.data]
  )
  const disabledSources = useMemo(
    () => (sourcesData?.data ?? []).filter((source) => !source.enabled),
    [sourcesData?.data]
  )

  const toggleSource = (name: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) next.add(name)
      else next.delete(name)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelected(
      checked ? new Set(enabledSources.map((source) => source.name)) : new Set()
    )
  }

  const busy = run.isPending
  const hasSelection = selected.size > 0

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !busy && props.onOpenChange(open)}
      title={t('Sync model parameters')}
      description={t(
        'Pull canonical model metadata from external sources. No automatic sync runs — this is manual only.'
      )}
      contentClassName='sm:max-w-3xl'
      contentHeight='min(65vh, 680px)'
      footer={
        <>
          <div className='text-muted-foreground mr-auto text-sm'>
            {hasSelection &&
              t('{{count}} source(s) selected', { count: selected.size })}
          </div>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => props.onOpenChange(false)}
          >
            {t('Close')}
          </Button>
          <Button
            variant='outline'
            disabled={busy || !hasSelection}
            onClick={() => {
              setDryRun(true)
              run.mutate()
            }}
          >
            {t('Preview')}
          </Button>
          <Button
            disabled={busy || !hasSelection}
            onClick={() => {
              setDryRun(false)
              run.mutate()
            }}
          >
            {run.isPending ? t('Syncing...') : t('Apply')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <label className='flex cursor-pointer items-center gap-2 text-sm'>
          <Checkbox
            checked={dryRun}
            onCheckedChange={(checked) => setDryRun(Boolean(checked))}
          />
          {t('Preview (dry run)')}
        </label>

        {isLoading && (
          <p className='text-muted-foreground text-sm'>
            {t('Loading sources...')}
          </p>
        )}
        {isError && (
          <ErrorState
            description={
              error instanceof Error
                ? error.message
                : t('Failed to load sync sources')
            }
            onRetry={() => void refetch()}
          />
        )}

        {!isLoading && !isError && sources.length > 0 && (
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <span className='text-sm font-medium'>
                {t('Available sources')}
              </span>
              <Button
                variant='ghost'
                size='sm'
                disabled={enabledSources.length === 0}
                onClick={() =>
                  toggleAll(selected.size !== enabledSources.length)
                }
              >
                {selected.size === enabledSources.length
                  ? t('Clear selection')
                  : t('Select all available')}
              </Button>
            </div>
            <div className='space-y-2'>
              {enabledSources.map((source) => (
                <div
                  key={source.name}
                  className='border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm'
                >
                  <Checkbox
                    checked={selected.has(source.name)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      toggleSource(source.name, Boolean(checked))
                    }
                    aria-label={t('Select source {{name}}', {
                      name: source.name,
                    })}
                  />
                  <span className='min-w-0'>
                    <span className='block font-medium'>{source.name}</span>
                    {source.description && (
                      <span className='text-muted-foreground block text-xs'>
                        {source.description}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {disabledSources.length > 0 && (
              <div className='text-muted-foreground text-xs'>
                {t('Disabled sources: {{names}}', {
                  names: disabledSources
                    .map((source) => source.name)
                    .join(', '),
                })}
              </div>
            )}
          </div>
        )}

        {!isLoading && !isError && sources.length === 0 && (
          <EmptyState title={t('No sync sources configured')} />
        )}

        {run.isError && (
          <ErrorState
            description={
              run.error instanceof Error
                ? run.error.message
                : t('Model parameter sync failed')
            }
          />
        )}

        {run.isSuccess && results && (
          <div className='space-y-3' role='status'>
            <h3 className='font-semibold'>
              {dryRun ? t('Preview results') : t('Sync results')}
            </h3>
            <StaticDataTable
              data={results}
              getRowKey={(result) => result.source}
              emptyContent={
                <EmptyState
                  title={t('No sync results')}
                  className='min-h-24 p-4'
                />
              }
              columns={[
                {
                  id: 'source',
                  header: t('Source'),
                  cell: (result) => (
                    <span className='font-mono text-sm'>{result.source}</span>
                  ),
                },
                {
                  id: 'status',
                  header: t('Status'),
                  cell: (result) =>
                    result.success ? (
                      <span className='text-success text-sm'>{t('OK')}</span>
                    ) : (
                      <span className='text-destructive text-sm'>
                        {t('Failed')}
                      </span>
                    ),
                },
                {
                  id: 'created',
                  header: t('Created'),
                  cell: (result) => (
                    <span className='text-sm'>{result.created}</span>
                  ),
                },
                {
                  id: 'updated',
                  header: t('Updated'),
                  cell: (result) => (
                    <span className='text-sm'>{result.updated}</span>
                  ),
                },
                {
                  id: 'skipped',
                  header: t('Skipped'),
                  cell: (result) => (
                    <span className='text-sm'>{result.skipped}</span>
                  ),
                },
                {
                  id: 'aliases',
                  header: t('Aliases'),
                  cell: (result) => (
                    <span className='text-sm'>{result.aliases}</span>
                  ),
                },
                {
                  id: 'unmatched',
                  header: t('Unmatched'),
                  cell: (result) => (
                    <span className='text-sm'>{result.unmatched}</span>
                  ),
                },
                {
                  id: 'error',
                  header: t('Error'),
                  cell: (result) =>
                    result.error ? (
                      <span className='text-destructive text-xs'>
                        {result.error}
                      </span>
                    ) : (
                      '—'
                    ),
                },
              ]}
            />
            {!dryRun && (
              <p className='text-muted-foreground text-sm'>
                {t('Synced models are now available in the parameter library.')}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
