/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3, or
(at your option) any later version.

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
}

export type DashboardFilters = {
  start_timestamp?: number
  end_timestamp?: number
  time_granularity?: TimeGranularity
  username?: string
}

export type DashboardChartPreferences = {
  consumptionDistributionChart: 'bar' | 'area'
  modelAnalyticsChart: ModelAnalyticsChartTab
  defaultTimeRangeDays: number
  defaultTimeGranularity: TimeGranularity
}

export type ModelAnalyticsChartTab = 'trend' | 'proportion' | 'top'

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
