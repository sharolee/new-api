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
import type { TimeGranularity } from '@/lib/time'

export interface QuotaDataItem {
  id?: number
  user_id?: number
  username?: string
  model_name?: string
  created_at: number
  token_used?: number
  count?: number
  quota?: number
}

export interface TokenQuotaDataItem {
  token_id: number
  token_name: string
  created_at: number
  count: number
  quota: number
  token_used: number
}

export interface ProcessedTokenChartData {
  spec_token_trend: VChartSpec
  spec_token_proportion: VChartSpec
  spec_token_ranking: VChartSpec
  totalCountDisplay: string
  totalQuotaDisplay: string
  totalTokensDisplay: string
}

export interface FlowQuotaDataItem {
  user_id?: number
  username?: string
  node_name?: string
  use_group?: string
  token_id?: number
  token_name?: string
  channel_id?: number
  channel_name?: string
  model_name?: string
  token_used?: number
  count?: number
  quota?: number
}

export type FlowMetric = 'quota' | 'tokens' | 'requests'
export type FlowOverflowMode = 'aggregate' | 'hide'
export type FlowRole = 'user' | 'admin' | 'root'

export type FlowNodeKind = 'user' | 'node' | 'token' | 'group' | 'model' | 'channel'

export interface FlowNodeFilter { kind: FlowNodeKind; id: string }
export interface FlowLinkSelection { source: string; target: string }

export interface FlowBuildOptions {
  role?: FlowRole
  selectedUsers?: string[]
  selectedNodes?: FlowNodeFilter[]
  activeNode?: FlowNodeFilter
  activeLink?: FlowLinkSelection
  colorPalette?: readonly string[]
  deletedTokenLabel?: (tokenId: number) => string
  visibleStages?: FlowNodeKind[]
  topNodeLimit?: number
  overflowMode?: FlowOverflowMode
  otherNodeLabel?: (kind: FlowNodeKind) => string
  maskSensitive?: boolean
}

export interface DashboardFlowNode {
  id: string
  label: string
  kind: FlowNodeKind
  value: number
  requests: number
  quota: number
  tokens: number
  color: string
  colorKey: string
  highlighted?: boolean
  dimmed?: boolean
}

export interface DashboardFlowLink {
  source: string
  target: string
  value: number
  requests: number
  quota: number
  tokens: number
  sourceLabel: string
  targetLabel: string
  color: string
  linkColor: string
  linkAlpha: number
  hoverColor: string
  colorKey: string
  share: number
  highlighted?: boolean
  dimmed?: boolean
}

export interface DashboardFlowGraph {
  nodes: DashboardFlowNode[]
  links: DashboardFlowLink[]
}

export interface FlowSummary {
  quota: number
  tokens: number
  requests: number
}

export interface FlowUserFilterOption {
  value: string
  label: string
  valueLabel: string
  valueRaw: number
  color: string
}

export interface FlowNodeFilterOption {
  kind: FlowNodeKind
  value: string
  label: string
  valueLabel: string
  valueRaw: number
  color: string
}

export interface FlowFilterOptions {
  users: FlowUserFilterOption[]
  nodes: FlowNodeFilterOption[]
}

export interface ProcessedFlowData {
  summary: FlowSummary
  flow: DashboardFlowGraph
  filterOptions: FlowFilterOptions
}

export type DashboardFilters = {
  start_timestamp?: Date
  end_timestamp?: Date
  time_granularity?: TimeGranularity
  username?: string
}

export type ConsumptionDistributionChartType = 'bar' | 'area'

export type DashboardChartPreferences = {
  consumptionDistributionChart: ConsumptionDistributionChartType
  modelAnalyticsChart: ModelAnalyticsChartTab
  defaultTimeRangeDays: number
  defaultTimeGranularity: TimeGranularity
}

export type ModelAnalyticsChartTab = 'trend' | 'proportion' | 'top'

export type TokenAnalyticsChartTab = 'trend' | 'proportion' | 'top'

export interface UserChartsFilters {
  timeGranularity: TimeGranularity
  selectedRange: number
  topUserLimit: number
}

export interface ApiInfoItem { url: string; route: string; description: string; color: string }
export interface PingStatus { latency: number | null; testing: boolean; error: boolean }
export type PingStatusMap = Record<string, PingStatus>

type VChartSpec = Record<string, any>

export interface ProcessedChartData {
  spec_pie: VChartSpec; spec_line: VChartSpec; spec_area: VChartSpec
  spec_model_line: VChartSpec; spec_rank_bar: VChartSpec
  spec_token_bar: VChartSpec; spec_token_area: VChartSpec
  totalQuotaDisplay: string; totalCountDisplay: string; totalTokensDisplay: string
}
export interface ProcessedUserChartData { spec_user_rank: VChartSpec; spec_user_trend: VChartSpec }

export interface AnnouncementItem {
  id?: number; content: string; publishDate?: string
  type?: 'default' | 'ongoing' | 'success' | 'warning' | 'error'; extra?: string
}
export interface FAQItem { id?: number; question: string; answer: string }

export interface ErrorAnalysisStats {
  total: number
  by_channel: Record<string, number>
  by_error: Record<string, number>
  by_date: ErrorDateStatsItem[]
  detail: ErrorDetailItem[]
}
export interface ErrorDateStatsItem {
  date: string; total: number
  by_error: Record<string, number>
  by_channel: Record<string, number>
}
export interface ErrorDetailItem { channel_id: number; channel_name: string; error_code: string; count: number }

export interface ErrorAnalysisFilters {
  start_timestamp?: number; end_timestamp?: number
  time_granularity: TimeGranularity
  username?: string; model_name?: string; channel?: number
}
export type ErrorAnalysisChartTab = 'channel' | 'error' | 'trend'

export type ModelRequestStatus =
  | 'success'
  | 'client_gone'
  | 'rate_limit'
  | 'quota'
  | 'unavailable'
  | 'other_error'

export interface ModelRequestResult {
  status: ModelRequestStatus
  /** Stream end reason when the response was not delivered (client_gone status). */
  end_reason: string
  created_at: number
  channel_id: number
  channel_name: string
  error_category: string
  error_code: string
  content: string
}

export interface ModelRequestRow {
  model: string
  total: number
  /** Requests in the whole window whose stream never delivered, beyond the cell limit. */
  client_gone_count: number
  requests: ModelRequestResult[]
}

export interface UptimeMonitor {
  name: string
  status: number
  group?: string
  uptime?: number
}

export interface UptimeGroupResult {
  categoryName: string
  monitors?: UptimeMonitor[]
}
