/**
 * Turn two blog revisions into a git-style unified diff string (bd 768w.16.10.5).
 *
 * The shared @startsimpli/ui <DiffViewer/> renders a RAW unified diff (it splits on
 * `diff --git` headers, colourises `@@` hunks and `+`/`-` lines). It does no
 * diffing itself — so to show a revision against its parent we synthesise that
 * unified-diff string here from the two blog bodies. Pure + line-based (LCS), so it
 * unit-tests without a backend and stays independent of any diff dependency.
 *
 * The algorithm: an LCS edit script over lines, grouped into hunks with a few lines
 * of surrounding context (like `git diff -U<n>`). Identical inputs yield '' so the
 * viewer shows its own empty state rather than an all-context block.
 */

type Op = { type: 'eq' | 'del' | 'ins'; line: string };

/** Split into lines, tolerating CRLF and a trailing newline (no phantom last line). */
function toLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

/**
 * A minimal LCS edit script between two line arrays. O(n*m) DP — blog bodies are a
 * few hundred lines at most. Returns ops in output order: equal/deleted/inserted.
 */
export function diffLines(oldLines: string[], newLines: string[]): Op[] {
  const n = oldLines.length;
  const m = newLines.length;
  // lcs[i][j] = LCS length of oldLines[i:] and newLines[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'eq', line: oldLines[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: 'del', line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: 'ins', line: newLines[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'del', line: oldLines[i++] });
  while (j < m) ops.push({ type: 'ins', line: newLines[j++] });
  return ops;
}

/** A prefixed diff body line: ' ' context, '-' deletion, '+' insertion. */
function prefixed(op: Op): string {
  const mark = op.type === 'eq' ? ' ' : op.type === 'del' ? '-' : '+';
  return `${mark}${op.line}`;
}

/**
 * Build the unified diff of two blog bodies as a single-file `diff --git` block the
 * DiffViewer can render. `context` is the number of unchanged lines kept around
 * each change (git's default 3). Returns '' when the bodies are identical.
 */
export function unifiedBlogDiff(
  oldText: string,
  newText: string,
  path = 'blog.md',
  context = 3,
): string {
  if (oldText === newText) return '';
  const ops = diffLines(toLines(oldText), toLines(newText));
  if (!ops.some((op) => op.type !== 'eq')) return '';

  // Indices of ops that are actual changes, expanded by `context` on each side and
  // merged into contiguous hunk ranges.
  const changed: number[] = [];
  ops.forEach((op, idx) => {
    if (op.type !== 'eq') changed.push(idx);
  });

  const ranges: Array<[number, number]> = [];
  for (const idx of changed) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length - 1, idx + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  const lines: string[] = [`diff --git a/${path} b/${path}`];
  for (const [start, end] of ranges) {
    // 1-based line numbers of the hunk's first old/new line.
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < start; k++) {
      if (ops[k].type !== 'ins') oldStart++;
      if (ops[k].type !== 'del') newStart++;
    }
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (let k = start; k <= end; k++) {
      const op = ops[k];
      if (op.type !== 'ins') oldCount++;
      if (op.type !== 'del') newCount++;
      body.push(prefixed(op));
    }
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    lines.push(...body);
  }
  return lines.join('\n');
}
