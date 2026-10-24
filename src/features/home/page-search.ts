import type { Page } from "../../types";

export function filterAndSortPages(
  pages: readonly Page[],
  query: string,
): Page[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return pages
    .filter(
      (page) =>
        !normalizedQuery ||
        page.title.toLocaleLowerCase().includes(normalizedQuery),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
