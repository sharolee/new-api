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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { ModelMappingsView } from './model-parameter-mappings-view'
import { ModelParameterOverviewView } from './model-parameter-overview-view'
import { ModelParametersTable } from './model-parameters-table'

type ModelParametersTab = 'overview' | 'parameters' | 'mappings'

export function ModelParametersSection() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ModelParametersTab>('overview')

  return (
    <div className='flex h-full min-h-0 flex-col gap-4'>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ModelParametersTab)}
      >
        <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
          <TabsTrigger value='overview'>{t('Overview')}</TabsTrigger>
          <TabsTrigger value='parameters'>{t('Parameters')}</TabsTrigger>
          <TabsTrigger value='mappings'>{t('Mappings')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className='min-h-0 flex-1'>
        {tab === 'overview' && <ModelParameterOverviewView />}
        {tab === 'parameters' && <ModelParametersTable />}
        {tab === 'mappings' && <ModelMappingsView />}
      </div>
    </div>
  )
}
