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
import { ModelParameterFormDialog } from './dialogs/model-parameter-form-dialog'
import { ModelParameterSyncDialog } from './dialogs/model-parameter-sync-dialog'
import { useModels } from './models-provider'

/**
 * Dialog hosts for the model parameter library. Mounted once at the Models
 * page level so dialog state survives table re-renders.
 */
export function ModelParameterLibraryDialogs() {
  const { parametersDialog, setParametersDialog } = useModels()

  return (
    <>
      <ModelParameterSyncDialog
        open={parametersDialog === 'sync'}
        onOpenChange={(open) => !open && setParametersDialog(null)}
      />
      <ModelParameterFormDialog
        open={parametersDialog === 'form'}
        onOpenChange={(open) => !open && setParametersDialog(null)}
      />
    </>
  )
}
