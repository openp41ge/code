/**
 * versions.ts — ordering app versions (semver, with a leading `v` allowed):
 * `0.1.0-alpha.9` < `0.1.0-alpha.10` < `0.1.0-beta.1` < `0.1.0` < `0.2.0`.
 */

function parts(version: string): { core: number[]; pre: string[] } {
  const [core, ...rest] = version.trim().replace(/^v/, "").split("+")[0].split("-");
  return {
    core: core.split(".").map((n) => Number(n) || 0),
    pre: rest.length > 0 ? rest.join("-").split(".") : [],
  };
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.core.length, pb.core.length); i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d !== 0) return d;
  }
  // A pre-release comes before its release.
  if (pa.pre.length === 0 || pb.pre.length === 0) return pb.pre.length - pa.pre.length;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx - ny;
    } else if (nx !== null || ny !== null) {
      return nx !== null ? -1 : 1; // numbers sort before words
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
