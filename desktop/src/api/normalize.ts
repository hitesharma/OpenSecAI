import type { RawScanDiff, RawVuln, ScanResults, Vulnerability } from "../types";

/**
 * Map a Trivy-style raw vulnerability to the UI-friendly shape rendered by
 * `ResultsPage`. Severity comparisons in the UI use uppercase; the
 * `Vulnerability.sev` field is typed as the uppercase union so we pass it
 * through unchanged.
 */
function toVuln(r: RawVuln): Vulnerability {
  return {
    cve: r.VulnerabilityID,
    sev: (r.Severity ?? "UNKNOWN") as Vulnerability["sev"],
    pkg: r.PkgName,
    from: r.InstalledVersion,
    to: r.FixedVersion ?? null,
    desc: r.Title ?? r.Description ?? "",
  };
}

/**
 * Convert a raw `diff.json` payload into the buckets the UI renders.
 *
 * Bucket semantics (from `opensecai/schemas/diff.py`):
 *   • fixed     → present in start scan, absent in end scan → fixed
 *   • new       → absent in start scan, present in end scan → newly added
 *   • persisted → present in both scans                     → persisted
 */
export function diffToResults(diff: RawScanDiff): ScanResults {
  return {
    fixed: diff.fixed.map(toVuln),
    added: diff.new.map(toVuln),
    persisted: diff.persisted.map(toVuln),
  };
}

export const EMPTY_RESULTS: ScanResults = {
  fixed: [],
  added: [],
  persisted: [],
};
