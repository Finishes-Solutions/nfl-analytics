/** Split a T-SQL script on GO lines (the client-side batch separator), dropping comment-only batches. */
export function splitBatches(text: string): string[] {
  return text
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((b) => b.trim())
    .filter((b) => b.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, '').trim().length > 0);
}
