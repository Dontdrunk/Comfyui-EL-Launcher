export interface NameKeyed {
  id?: string | null;
  name?: string | null;
}

export function hitsName(
  node: NameKeyed | null | undefined,
  query: string
): boolean;

export function filterByName<T extends NameKeyed>(
  nodes: readonly T[] | null | undefined,
  query: string
): T[];

export function paginate<T>(
  nodes: readonly T[] | null | undefined,
  page?: number,
  limit?: number
): {
  nodes: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
