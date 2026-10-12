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
import type {
  GetModelsParams,
  SearchModelsParams,
  GetAvailableModelsParams,
  GetModelParametersParams,
  GetModelMappingsParams,
  GetModelOverviewParams,
} from '../types'

/**
 * React Query cache keys for models
 */
export const modelsQueryKeys = {
  all: ['models'] as const,
  lists: () => [...modelsQueryKeys.all, 'list'] as const,
  list: (filters: GetModelsParams | SearchModelsParams) =>
    [...modelsQueryKeys.lists(), filters] as const,
  detail: (id: number) => [...modelsQueryKeys.all, 'detail', id] as const,
  missing: () => [...modelsQueryKeys.all, 'missing'] as const,
}

/**
 * React Query cache keys for vendors
 */
export const vendorsQueryKeys = {
  all: ['vendors'] as const,
  lists: () => [...vendorsQueryKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) =>
    [...vendorsQueryKeys.lists(), filters] as const,
  detail: (id: number) => [...vendorsQueryKeys.all, 'detail', id] as const,
}

/**
 * React Query cache keys for prefill groups
 */
export const prefillGroupsQueryKeys = {
  all: ['prefill-groups'] as const,
  lists: () => [...prefillGroupsQueryKeys.all, 'list'] as const,
  list: (type?: string) => [...prefillGroupsQueryKeys.lists(), type] as const,
}

/**
 * React Query cache keys for deployments
 */
export const deploymentsQueryKeys = {
  all: ['deployments'] as const,
  lists: () => [...deploymentsQueryKeys.all, 'list'] as const,
  list: (filters: {
    keyword?: string
    status?: string
    p?: number
    page_size?: number
  }) => [...deploymentsQueryKeys.lists(), filters] as const,
  detail: (id: string | number) =>
    [...deploymentsQueryKeys.all, 'detail', id] as const,
}

/**
 * React Query cache keys for available models (abilities table)
 */
export const availableModelsQueryKeys = {
  all: ['available-models'] as const,
  lists: () => [...availableModelsQueryKeys.all, 'list'] as const,
  list: (filters: GetAvailableModelsParams) =>
    [...availableModelsQueryKeys.lists(), filters] as const,
  detail: (modelName: string) =>
    [...availableModelsQueryKeys.all, 'detail', modelName] as const,
}

/**
 * React Query cache keys for model categories
 */
export const modelCategoriesQueryKeys = {
  all: ['model-categories'] as const,
  lists: () => [...modelCategoriesQueryKeys.all, 'list'] as const,
  list: () => [...modelCategoriesQueryKeys.lists()] as const,
  detail: (id: number) =>
    [...modelCategoriesQueryKeys.all, 'detail', id] as const,
}

/**
 * React Query cache keys for the available-model channel filter options
 */
export const availableChannelsQueryKeys = {
  all: ['available-channels'] as const,
  list: () => [...availableChannelsQueryKeys.all, 'list'] as const,
}

/**
 * React Query cache keys for the model parameter library (canonical models)
 */
export const modelParametersQueryKeys = {
  all: ['model-parameters'] as const,
  lists: () => [...modelParametersQueryKeys.all, 'list'] as const,
  list: (filters: GetModelParametersParams) =>
    [...modelParametersQueryKeys.lists(), filters] as const,
  sources: () => [...modelParametersQueryKeys.all, 'sources'] as const,
  assignOptions: () =>
    [...modelParametersQueryKeys.all, 'assign-options'] as const,
}

/**
 * React Query cache keys for the model name mapping view
 */
export const modelMappingsQueryKeys = {
  all: ['model-parameter-mappings'] as const,
  lists: () => [...modelMappingsQueryKeys.all, 'list'] as const,
  list: (filters: GetModelMappingsParams) =>
    [...modelMappingsQueryKeys.lists(), filters] as const,
}

/**
 * React Query cache keys for the model parameter overview view
 */
export const modelOverviewQueryKeys = {
  all: ['model-parameter-overview'] as const,
  lists: () => [...modelOverviewQueryKeys.all, 'list'] as const,
  list: (filters: GetModelOverviewParams) =>
    [...modelOverviewQueryKeys.lists(), filters] as const,
}
