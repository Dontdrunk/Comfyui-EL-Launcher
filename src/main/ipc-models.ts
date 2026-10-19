import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ModelScanReport } from '@shared/types'
import { resolveComfyPaths } from './lib/paths'
import { deleteModelFile, revealModelFile, scanModels } from './services/models'
import { pickRoot } from './services/settings'

export function registerModelsIpc(): void {
  ipcMain.handle(IPC.modelsScan, async (_e, root?: string): Promise<ModelScanReport> => {
    return scanModels(pickRoot(root))
  })

  ipcMain.handle(IPC.modelsDelete, async (_e, rel: string, root?: string): Promise<void> => {
    await deleteModelFile(pickRoot(root), rel)
  })

  ipcMain.handle(IPC.modelsReveal, async (_e, rel: string, root?: string): Promise<void> => {
    await revealModelFile(pickRoot(root), rel)
  })

  ipcMain.handle(IPC.modelsDir, async (_e, root?: string): Promise<string> => {
    return resolveComfyPaths(pickRoot(root)).modelsDir
  })
}
