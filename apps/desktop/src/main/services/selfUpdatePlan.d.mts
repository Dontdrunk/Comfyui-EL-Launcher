export interface UpdateFile {
  url: string;
  sha512: string;
  size: number;
}

export function parseLatestYml(
  text: string
): { version: string; files: UpdateFile[] } | null;
export function isNewer(current: string, remote: string): boolean;
export function pickFile(
  files: UpdateFile[],
  portable: boolean
): UpdateFile | null;
export function fileNameOf(url: string): string;
export function isLauncherAsset(name: string): boolean;
export function sha512Base64(data: Uint8Array): string;

export interface SpeedMeter {
  /** 记一次采样：累计已下载字节 + 采样时刻 */
  sample(bytes: number, at: number): void;
  /** 字节/秒；不足两个有效采样时返回 null */
  rate(): number | null;
}

export function createSpeedMeter(windowMs?: number): SpeedMeter;
