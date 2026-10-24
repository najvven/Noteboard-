import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "../src/types";
import { filterAndSortPages } from "../src/features/home/page-search";

const page = (id: string, title: string, updatedAt: number): Page => ({
  version: 3,
  id,
  title,
  width: 800,
  height: 600,
  updatedAt,
  isPinned: false,
  elements: [],
});

test("page search is case-insensitive, trims the query and preserves recent order", () => {
  const pages = [
    page("1", "Project Alpha", 10),
    page("2", "alpha notes", 30),
    page("3", "Roadmap", 50),
  ];

  const result = filterAndSortPages(pages, "  ALPHA ");

  assert.deepEqual(
    result.map((item) => item.id),
    ["2", "1"],
  );
  assert.deepEqual(
    pages.map((item) => item.id),
    ["1", "2", "3"],
  );
});
