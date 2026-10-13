/**
 * What a proposed change does to one list in a guide, line by line, so the manager sees
 * the guide as it would be with each new, changed and removed line marked.
 */

export type Row<T> =
  | { kind: "same"; item: T; index: number }
  | { kind: "added"; item: T; index: number }
  | { kind: "changed"; item: T; was: T; index: number }
  | { kind: "removed"; was: T };

export type Mark = "added" | "changed" | undefined;

/**
 * Longest common subsequence on `key`, then each run of removed lines next to a run of
 * added lines is paired up as changed lines (an edited step reads as one change, not a
 * removal plus an addition). Lines with the same key but different details (`same`
 * returns false) are changed too.
 */
export function diffRows<T>(
  before: T[],
  after: T[],
  key: (item: T) => string,
  same: (a: T, b: T) => boolean = () => true,
): Row<T>[] {
  const a = before.map(key);
  const b = after.map(key);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: Row<T>[] = [];
  let removed: T[] = [];
  let added: { item: T; index: number }[] = [];
  const flush = () => {
    const pairs = Math.min(removed.length, added.length);
    for (let k = 0; k < pairs; k++)
      rows.push({ kind: "changed", item: added[k].item, was: removed[k], index: added[k].index });
    for (const was of removed.slice(pairs)) rows.push({ kind: "removed", was });
    for (const { item, index } of added.slice(pairs)) rows.push({ kind: "added", item, index });
    removed = [];
    added = [];
  };

  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      const kept = same(before[i], after[j]);
      rows.push(
        kept
          ? { kind: "same", item: after[j], index: j }
          : { kind: "changed", item: after[j], was: before[i], index: j },
      );
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      added.push({ item: after[j], index: j });
      j++;
    } else {
      removed.push(before[i]);
      i++;
    }
  }
  flush();
  return rows;
}

/** The rows of an unchanged list. */
export function sameRows<T>(items: T[]): Row<T>[] {
  return items.map((item, index) => ({ kind: "same", item, index }));
}

/** How many rows differ. */
export function countChanges(rows: Row<unknown>[]): number {
  return rows.filter((r) => r.kind !== "same").length;
}
