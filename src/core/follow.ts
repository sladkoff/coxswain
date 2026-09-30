// #31: where a comment's lines went. A line diff (Myers) from the text a comment was written on to another version maps
// each old line to its new one, or -1 where it changed. Pure, so node --test runs it.

// ponytail: past this many edits between two versions the diff gives up and only the common start and end count as
// kept; a linear-space Myers if big rewrites of commented files matter.
const maxEdits = 2000;

// For each line of a, its index in b if it's kept there, else -1.
export function lineMap(a: string[], b: string[]): Int32Array {
  const map = new Int32Array(a.length).fill(-1);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) map[p] = p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) {
    map[a.length - 1 - s] = b.length - 1 - s;
    s++;
  }
  for (const [x, y] of kept(a.slice(p, a.length - s), b.slice(p, b.length - s))) map[p + x] = p + y;
  return map;
}

// The lines a and b share, as pairs of indices: Myers' greedy diff, walked back through each step's furthest points.
function kept(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = []; // v at the start of each step d, for k from -d-1 to d+1
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])
          ? v[off + k + 1]
          : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return back(trace, n, m);
    }
  }
  return [];
}

function back(trace: Int32Array[], n: number, m: number): [number, number][] {
  const pairs: [number, number][] = [];
  let [x, y] = [n, m];
  for (let d = trace.length - 1; d >= 0; d--) {
    const at = (k: number) => trace[d][k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) pairs.push([--x, --y]);
    [x, y] = [prevX, prevY];
  }
  return pairs;
}

// Lines start–end (1-based) of the old text in the new one: moved there if they're all kept and still together, else
// changed, with the lines that now stand between the kept ones around them.
export function follow(
  map: Int32Array,
  b: string[],
  start: number,
  end: number,
): { status: "moved"; start: number; end: number } | { status: "changed"; now: string } {
  const at = [...map.subarray(start - 1, end)];
  if (at.length === end - start + 1 && at.every((y, i) => y >= 0 && y === at[0] + i))
    return { status: "moved", start: at[0] + 1, end: at[0] + at.length };
  let before = start - 2;
  while (before >= 0 && map[before] < 0) before--;
  let after = end;
  while (after < map.length && map[after] < 0) after++;
  const from = before >= 0 ? map[before] + 1 : 0;
  const to = after < map.length ? map[after] : b.length;
  return { status: "changed", now: b.slice(from, to).join("\n") };
}
