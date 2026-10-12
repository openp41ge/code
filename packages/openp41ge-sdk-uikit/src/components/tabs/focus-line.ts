/**
 * The focus line on a tab handle: the focused tab (the active tab of the
 * focused cell or sidebar, while the window is focused) has a blue bar across
 * its top, half the tab's width and centred, 3px thick with rounded ends.
 *
 * Every tab bar uses this rule, so the line looks the same everywhere. The
 * tab marks itself `data-focused`. The bar is drawn over the tab's contents,
 * including its full-height close button's hover background.
 */

/** The focus line's CSS for tabs matching `tab` (e.g. ".tab-btn"). */
export function tabFocusLineCss(tab: string): string {
  return `
    ${tab} {
      position: relative;
    }
    ${tab}[data-focused]::after {
      content: "";
      position: absolute;
      top: 0;
      left: 25%;
      width: 50%;
      height: 3px;
      border-radius: 2px;
      background: #4a9eff;
      pointer-events: none;
      z-index: 1;
    }
  `;
}
