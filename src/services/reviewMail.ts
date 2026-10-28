/**
 * What a bulk approve or reject tells each person: their own entries only.
 * A Manager's selection can hold several people's rows; each of them gets one
 * email with their count and categories (or products), never the colleagues'
 * rows reviewed with theirs. People without an email address are left out.
 */
export type ReviewSummary<U> = {
  creator: U;
  count: number;
  items: { categoryName: string; count: number }[];
};

export const reviewSummaries = <R, U extends { user_id: number; email?: string | null }>(
  rows: R[],
  creatorOf: (row: R) => U | null | undefined,
  labelOf: (row: R) => string,
): ReviewSummary<U>[] => {
  const byCreator = new Map<number, { creator: U; labels: Map<string, number>; count: number }>();
  for (const row of rows) {
    const creator = creatorOf(row);
    if (!creator?.email) continue;
    let summary = byCreator.get(creator.user_id);
    if (!summary) byCreator.set(creator.user_id, (summary = { creator, labels: new Map(), count: 0 }));
    const label = labelOf(row);
    summary.labels.set(label, (summary.labels.get(label) || 0) + 1);
    summary.count++;
  }
  return [...byCreator.values()].map(({ creator, labels, count }) => ({
    creator,
    count,
    items: [...labels].map(([categoryName, n]) => ({ categoryName, count: n })),
  }));
};
