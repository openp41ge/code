/**
 * PaneHeaderButton — reusable button for pane header bars.
 *
 * Fills the full height of the header (28px default).
 * Minimum width equals the height (square).
 * Width extends for longer content but never shrinks below the height.
 *
 * Usage:
 *   const btn = paneHeaderButton({ content: "\u00D7" });
 *   btn.onclick = () => closePane();
 *   header.appendChild(btn);
 */

export interface PaneHeaderButtonOptions {
  /** Inner content — plain text or HTML markup. */
  content: string;
  /** CSS class name (optional, e.g. "pane-close" for openp41ge-pane.ts lookup). */
  className?: string;
  /** Tooltip text (optional). */
  title?: string;
  /** Custom click handler (optional). */
  onClick?: () => void;
}

export function paneHeaderButton(options: PaneHeaderButtonOptions): HTMLElement {
  const { content, className, title, onClick } = options;

  const btn = document.createElement("div");
  if (className) btn.className = className;
  if (title) btn.title = title;

  btn.textContent = content;
  btn.className = className || "";
  btn.classList.add(
    "shrink-0",
    "min-w-[28px]",
    "self-stretch",
    "flex",
    "items-center",
    "justify-center",
    "px-2",
    "bg-transparent",
    "text-muted",
    "cursor-pointer",
    "text-sm",
    "leading-none",
    "opacity-50",
    "border-none",
    "box-border",
    "transition-[background,color,opacity]",
    "duration-100",
    "select-none",
  );
  if (title) btn.title = title;

  // Consistent hover / leave
  btn.addEventListener("mouseenter", () => {
    btn.classList.add("bg-hover", "text-primary");
    btn.style.opacity = "1";
  });
  btn.addEventListener("mouseleave", () => {
    btn.classList.remove("bg-hover", "text-primary");
    btn.style.opacity = "0.5";
  });

  if (onClick) {
    btn.addEventListener("click", onClick);
  }

  return btn;
}
