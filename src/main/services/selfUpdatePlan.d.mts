export interface UpdateFile {
  url: string
  sha512: string
  size: number
}

export function parseLatestYml(text: string): { version: string; files: UpdateFile[] } | null
export function isNewer(current: string, remote: string): boolean
export function pickFile(files: UpdateFile[], portable: boolean): UpdateFile | null
export function fileNameOf(url: string): string
export function isLauncherAsset(name: string): boolean
export function sha512Base64(data: Uint8Array): string
