export interface ProcessOwnerLike {
  name?: string | null;
  commandLine?: string | null;
}

export interface PortCandidate extends ProcessOwnerLike {
  pid?: number | string | null;
  localAddress?: string | null;
}

export function normalizePath(value: unknown): string;

export function listenersOf(
  netstatText: string | null | undefined,
  port: number
): number[];

export function looksLikePython(
  owner: ProcessOwnerLike | null | undefined
): boolean;

export function looksLikeComfy(
  owner: ProcessOwnerLike | null | undefined
): boolean;

export function isOurComfy(
  owner: ProcessOwnerLike | null | undefined,
  comfyRoot: string
): boolean;

export function isLoopback(address: unknown): boolean;

export function pickOwner(
  candidates: readonly PortCandidate[] | null | undefined,
  comfyRoot: string
): {
  pid: number;
  name: string;
  commandLine: string | null;
  isOurComfy: boolean;
} | null;
