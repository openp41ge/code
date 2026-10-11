/**
 * Tooltip content model — discriminated union of the two variants.
 *
 *   - `simple`: one line of label text.
 *   - `detail`: a bold title plus a wrapping explanatory subtitle.
 */

export type TooltipContent =
  { type: "simple"; text: string } | { type: "detail"; title: string; subtitle: string };

/** True when the content is the richer title+subtitle variant. */
export function isDetailTooltip(content: TooltipContent): boolean {
  return content.type === "detail";
}
