/**
 * OverlayScrollbar — a floating, non-layout-taking scrollbar.
 *
 * Unlike the classic `Openp41geScrollbar` (which uses native webkit
 * `::-webkit-scrollbar` styling and occupies layout space), this scrollbar
 * overlays the scroll target with absolutely-positioned track/thumb elements
 * that can follow the cursor outside the window (via the DragGhostManager) and
 * support auto-hide. Used by the file editor, window manager, and agents chat.
 *
 * Kept in its own module so each file contains a single class (oxlint
 * `max-classes-per-file`).
 */

export type ScrollbarAxis = "vertical" | "horizontal" | "both";

export interface OverlayScrollbarOptions {
  /** Scroll axes to render.  Default: "vertical". */
  axis?: ScrollbarAxis;
  /** Presented thickness of the thumb at rest (px).  Default: 6. */
  size?: number;
  /** Thickness the thumb animates to on hover/active/drag (px).  Default: 10. */
  hoverSize?: number;
  /** Shortest the thumb may be rendered (px).  Default: 24. */
  minThumbSize?: number;
  /** Element the track/thumb are placed in.  Must be position:relative and not
   *  the scroll target.  When omitted, the scroll target is wrapped. */
  container?: HTMLElement;
  /** CSS inset for the track within the container (e.g. `{ top: "44px" }` to
   *  start below a header).  Default: all 0. */
  inset?: { top?: string; right?: string; bottom?: string; left?: string };
  /** Stacking order of the track (default 20).  Pass a low value when the track
   *  must sit under sibling overlays (e.g. drawers/modals). */
  zIndex?: number;
  /** Thumb fill colour (default: translucent white).  Set CSS-friendly rgba/hex. */
  thumbColor?: string;
  /** Thumb fill colour on hover / active / drag (default: brighter translucent white). */
  thumbHoverColor?: string;
  /** Where to inject the overlay styles.  Pass a `ShadowRoot` when the target
   *  element lives in a shadow tree (global styles never reach it). */
  styleTarget?: Document | ShadowRoot;
  /** Fade the scrollbar out after the cursor leaves the scroll area (default false). */
  autoHide?: boolean;
  /** Milliseconds to wait after the cursor leaves before fading out (default 2500). */
  autoHideDelay?: number;
  /** Show a pin icon at the bottom of a vertical track that appears while the
   *  scroll view is "pinned" to the bottom (auto-following the newest content).
   *  The icon is purely decorative (not a button) and hides when the scrollbar
   *  auto-hides. The host owns the pinned state, passing the initial value here
   *  and updating it via `setPinned()`. The icon is only created when this
   *  option is provided.  Default: false (feature off). */
  pinned?: boolean;
  /** Show a scroll-to-bottom arrow button at the bottom of a vertical track
   *  (a distinct control from the pin icon). It appears whenever the view has
   *  content to scroll and is not already at the bottom, gets a background on
   *  hover, and clicking it scrolls the view back to the bottom. Unlike the pin
   *  (which follows the auto-hide fade), the arrow stays available while the
   *  view is scrolled up. Default: false (feature off). */
  scrollToBottom?: boolean;
}

const OVERLAY_DEFAULT_SIZE = 6;
const OVERLAY_DEFAULT_HOVER_SIZE = 10;
const OVERLAY_DEFAULT_MIN_THUMB = 24;
const OVERLAY_DEFAULT_THUMB_COLOR = "rgba(255,255,255,0.22)";
const OVERLAY_DEFAULT_THUMB_HOVER_COLOR = "rgba(255,255,255,0.42)";
const OVERLAY_DEFAULT_AUTO_HIDE_DELAY = 2500;
const OVERLAY_FADE_MS = 250;

/** Pin icon shown at the bottom of the track while the view is pinned to the
 *  bottom (auto-following the newest content).  User-supplied glyph. */
const PIN_ICON =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor">` +
  `<path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z"/></svg>`;

/** Downward-arrow glyph for the scroll-to-bottom button. */
const SCROLL_DOWN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 1.5v6.5M2.2 4.9 5 7.7l2.8-2.8"/></svg>`;

// ─── Pure geometry (unit-testable) ─────────────────────────────────────

/**
 * Length of the thumb along the track.
 * `viewport`/`scrollLen` are the scroll target's visible and full content
 * lengths along the axis.  The thumb is proportional to the visible fraction,
 * clamped to at least `minThumbSize`.
 */
export function computeThumbLength(
  viewport: number,
  scrollLen: number,
  trackLen: number,
  minThumbSize: number = OVERLAY_DEFAULT_MIN_THUMB,
): number {
  if (viewport <= 0 || scrollLen <= 0 || scrollLen <= viewport) return trackLen;
  const len = (viewport / scrollLen) * trackLen;
  return Math.min(trackLen, Math.max(minThumbSize, len));
}

/**
 * Offset of the thumb along the track, proportional to the scroll position.
 * `scrollPos` ranges over `[0, scrollLen - viewport]`, mapped onto the
 * `[0, trackLen - thumbLen]` travel of the thumb.
 */
export function computeThumbPosition(
  scrollPos: number,
  scrollLen: number,
  viewport: number,
  trackLen: number,
  thumbLen: number,
): number {
  const travel = scrollLen - viewport;
  if (travel <= 0) return 0;
  const maxOffset = trackLen - thumbLen;
  if (maxOffset <= 0) return 0;
  return (Math.max(0, scrollPos) / travel) * maxOffset;
}

// ─── Component ─────────────────────────────────────────────────────────

interface AxisState {
  track: HTMLElement;
  thumb: HTMLElement;
  pin?: HTMLElement;
  scrollDown?: HTMLElement;
}

export class OverlayScrollbar {
  private _target: HTMLElement;
  private _wrap: HTMLElement | null = null;
  private _container: HTMLElement;
  private _axis: ScrollbarAxis;
  private _size: number;
  private _hoverSize: number;
  private _minThumbSize: number;
  private _inset: { top?: string; right?: string; bottom?: string; left?: string };
  private _zIndex: number;
  private _thumbColor: string;
  private _thumbHoverColor: string;
  private _styleTarget: Document | ShadowRoot | undefined;
  private _axes: Partial<Record<ScrollbarAxis, AxisState>> = {};
  private _destroyed = false;
  private _autoHide = false;
  private _autoHideDelay = OVERLAY_DEFAULT_AUTO_HIDE_DELAY;
  private _pinEnabled = false;
  private _pinned = false;
  private _scrollDownEnabled = false;
  private _hideTimer = 0;
  private _pointerInside = false;
  private _visible = true;
  private _onPointerEnter: () => void = () => {};
  private _onPointerLeave: () => void = () => {};
  private _onScroll: () => void = () => {};
  private _ro: ResizeObserver | null = null;
  private _mo: MutationObserver | null = null;
  private _raf = 0;

  private constructor(
    target: HTMLElement,
    container: HTMLElement,
    options: OverlayScrollbarOptions,
  ) {
    this._target = target;
    this._container = container;
    this._axis = options.axis ?? "vertical";
    this._size = options.size ?? OVERLAY_DEFAULT_SIZE;
    this._hoverSize = options.hoverSize ?? OVERLAY_DEFAULT_HOVER_SIZE;
    this._minThumbSize = options.minThumbSize ?? OVERLAY_DEFAULT_MIN_THUMB;
    this._inset = options.inset ?? {};
    this._zIndex = options.zIndex ?? 20;
    this._thumbColor = options.thumbColor ?? OVERLAY_DEFAULT_THUMB_COLOR;
    this._thumbHoverColor = options.thumbHoverColor ?? OVERLAY_DEFAULT_THUMB_HOVER_COLOR;
    this._styleTarget = options.styleTarget;
    this._autoHide = options.autoHide ?? false;
    this._autoHideDelay = options.autoHideDelay ?? OVERLAY_DEFAULT_AUTO_HIDE_DELAY;
    this._pinEnabled = options.pinned !== undefined;
    this._pinned = options.pinned ?? false;
    this._scrollDownEnabled = options.scrollToBottom === true;
  }

  static attach(target: HTMLElement, options: OverlayScrollbarOptions = {}): OverlayScrollbar {
    let container = options.container;
    let wrap: HTMLElement | null = null;
    if (!container) {
      wrap = document.createElement("div");
      wrap.style.position = "relative";
      wrap.style.overflow = "hidden";
      wrap.style.flex = "1";
      wrap.style.minHeight = "0";
      wrap.style.height = "100%";
      const parent = target.parentElement;
      if (parent) {
        parent.insertBefore(wrap, target);
        wrap.appendChild(target);
      } else {
        wrap.appendChild(target);
      }
      container = wrap;
    }
    const sb = new OverlayScrollbar(target, container, options);
    sb._wrap = wrap;
    sb._mount();
    return sb;
  }

  private _mount(): void {
    this._target.style.scrollbarWidth = "none";
    this._target.setAttribute("data-overlay-scrollbar", "");
    this._injectScopedStyles();

    if (this._axis === "vertical" || this._axis === "both") this._buildAxis("vertical");
    if (this._axis === "horizontal" || this._axis === "both") this._buildAxis("horizontal");

    this._onScroll = () => {
      this.update();
      this._poke();
    };
    this._target.addEventListener("scroll", this._onScroll, { passive: true });
    this._ro = new ResizeObserver(() => this.update());
    this._ro.observe(this._target);
    this._mo = new MutationObserver(() => {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this.update();
      });
    });
    this._mo.observe(this._target, { childList: true, subtree: true });

    if (this._autoHide) {
      this._onPointerEnter = () => {
        this._pointerInside = true;
        this._show();
      };
      this._onPointerLeave = () => {
        this._pointerInside = false;
        this._scheduleHide();
      };
      this._container.addEventListener("pointerenter", this._onPointerEnter);
      this._container.addEventListener("pointerleave", this._onPointerLeave);
      // Start visible, then fade if the cursor hasn't entered after the delay.
      this._setVisible(true);
      this._scheduleHide();
    }

    this.update();
  }

  private _injectScopedStyles(): void {
    const id = "overlay-scrollbar-style";
    const text = `
      [data-overlay-scrollbar]::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      .os-track { position: absolute; z-index: 20; pointer-events: auto; box-sizing: border-box;
        /* The thumb animates with a springy easing that overshoots its target
           position; hide the overshoot by clipping it to the track box instead
           of letting it stick out past the end (or get cut by the container). */
        overflow: hidden;
        opacity: 1; transition: opacity ${OVERLAY_FADE_MS}ms ease; }
      .os-track.os-hidden { opacity: 0; pointer-events: none; }
      .os-track--v { border-left: 1px solid rgba(128,128,128,0.08); }
      .os-track--h { border-top: 1px solid rgba(128,128,128,0.08); }
      .os-thumb {
        position: absolute; background: var(--os-thumb, ${OVERLAY_DEFAULT_THUMB_COLOR}); border-radius: 0;
        box-sizing: border-box; pointer-events: auto; cursor: default;
        transition: width 0.18s ease, height 0.18s ease,
                    background-color 0.15s ease, left 0.18s ease, top 0.18s ease;
      }
      .os-thumb:hover, .os-thumb.dragging { background: var(--os-thumb-hover, ${OVERLAY_DEFAULT_THUMB_HOVER_COLOR}); }
      .os-track--v .os-thumb {
        height: 100%; right: 0;
        width: var(--os-size, ${this._size}px);
      }
      .os-track--v:hover .os-thumb, .os-track--v .os-thumb.dragging { width: var(--os-hover, ${this._hoverSize}px); }
      .os-track--h .os-thumb {
        width: 100%; bottom: 0;
        height: var(--os-size, ${this._size}px);
      }
      .os-track--h:hover .os-thumb, .os-track--h .os-thumb.dragging { height: var(--os-hover, ${this._hoverSize}px); }
      .os-pin {
        position: absolute;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* Cover the full track box (no 1px sliver left exposed on the hover
           side) so pointing anywhere over the bar's width hits the pin's
           hover state instead of falling through to the track's hover-widen. */
        width: var(--os-hover, 10px);
        height: var(--os-hover, 10px);
        /* The visible scrollbar bar is right-aligned inside the track box
           (os-size = track box - 1px border), e.g. 9px at [r-9,r] whose
           centre is 0.5px right of the box centre. Nudge the glyph content
           right by that 1px border so the icon centres over the bar. */
        padding-left: 1px;
        box-sizing: border-box;
        /* A dark grey — clearly darker than the translucent thumb (which
           renders ~#4f4f4f) so the glyph stands out on the scrollbar. */
        color: #2e2e2e;
        /* Hoverable (for its tooltip + hover chip); because the pin sits on
           top of the track it captures the hover, so the bar's own
           hover-widen no longer fires while the pin is pointed at. */
        pointer-events: auto;
        cursor: default;
        user-select: none;
        transition: opacity 0.15s ease, background-color 0.12s ease, color 0.12s ease;
      }
      .os-pin:hover {
        /* A dark chip — darker than the light hover behind the scroll-down
           button so the two indicators read differently. */
        background: rgba(0, 0, 0, 0.5);
        color: #d4d4d4;
      }
      .os-pin svg {
        /* The pushpin's ink spans only the middle half of its square viewBox
           width, so at 100% of the 10px strip it renders a thin ~4.5px glyph.
           Render the svg larger than the box and let flex centre it (the
           overflow past the strip is transparent — only the ink shows), so
           the pin is ~6px wide — thinner than the scroll-down arrow, with a
           clear 1px gap on either side. The glyph ink stays centred over the
           visible bar. */
        width: 12px; height: 12px;
        flex: none;
        display: block;
      }
      .os-pin.os-pin-hidden { opacity: 0; pointer-events: none; }
      .os-scroll-down {
        position: absolute;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* Same width as the track strip (not wider), but taller, so the
           arrow reads bigger while the icon has breathing room above it
           inside the hover chip (the glyph no longer touches the chip's top
           edge). */
        width: var(--os-hover, 10px);
        height: 18px;
        /* Nudge the arrow glyph right to centre it over the visible bar (the
           bar sits 1px in from the track box's left border — see .os-pin). */
        padding-left: 1px;
        padding-top: 4px;
        box-sizing: border-box;
        /* Match the app's standard border-line grey (not the faded track
           border), so the arrow reads as one of the UI's line greys. */
        color: var(--border-color, #2a2a2a);
        pointer-events: auto;
        cursor: pointer;
        user-select: none;
        transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;
      }
      .os-scroll-down svg {
        width: 11px; height: 11px;
        flex: none;
        display: block;
      }
      .os-scroll-down:hover {
        color: #e6e6e6;
        background: rgba(120, 120, 120, 0.35);
      }
      .os-scroll-down.os-scroll-down-hidden { opacity: 0; pointer-events: none; }
    `;
    const root = this._styleTarget;
    if (root instanceof ShadowRoot) {
      if (root.getElementById(id)) return;
      const s = document.createElement("style");
      s.id = id;
      s.textContent = text;
      root.appendChild(s);
      return;
    }
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = text;
    document.head.appendChild(s);
  }

  private _buildAxis(axis: ScrollbarAxis): void {
    const track = document.createElement("div");
    track.className = `os-track os-track--${axis === "vertical" ? "v" : "h"}`;
    track.style.zIndex = String(this._zIndex);
    const ins = this._inset;
    if (axis === "vertical") {
      Object.assign(track.style, {
        top: ins.top ?? "0",
        right: ins.right ?? "0",
        bottom: ins.bottom ?? "0",
        width: `${this._hoverSize}px`,
      });
    } else {
      Object.assign(track.style, {
        left: ins.left ?? "0",
        right: ins.right ?? "0",
        bottom: ins.bottom ?? "0",
        height: `${this._hoverSize}px`,
      });
    }
    track.style.setProperty("--os-size", `${this._size}px`);
    track.style.setProperty("--os-hover", `${this._hoverSize}px`);
    track.style.setProperty("--os-thumb", this._thumbColor);
    track.style.setProperty("--os-thumb-hover", this._thumbHoverColor);
    const thumb = document.createElement("div");
    thumb.className = "os-thumb";
    thumb.setAttribute("data-os-axis", axis);
    track.appendChild(thumb);
    this._container.appendChild(track);
    this._axes[axis] = { track, thumb };

    if (this._pinEnabled && axis === "vertical") {
      const pin = document.createElement("span");
      pin.className = "os-pin os-pin-hidden";
      pin.setAttribute("aria-hidden", "true");
      pin.setAttribute("data-os-axis", axis);
      pin.innerHTML = PIN_ICON;
      const ins = this._inset;
      Object.assign(pin.style, {
        // A small gap of clearance above the container's bottom edge so the
        // glyph doesn't sit flush against the line without hanging too far
        // up. `calc(0 + 4px)` is invalid (number + length), so default
        // `bottom` to a unit value.
        bottom:
          ins.bottom === undefined || ins.bottom === "0" ? "4px" : `calc(${ins.bottom} + 4px)`,
        right: ins.right ?? "0",
        zIndex: String(this._zIndex + 1),
      });
      // Size the square icon to the track width (matches `--os-hover`).
      pin.style.setProperty("--os-hover", `${this._hoverSize}px`);
      this._container.appendChild(pin);
      this._axes[axis]!.pin = pin;
    }

    if (this._scrollDownEnabled && axis === "vertical") {
      const btn = document.createElement("span");
      btn.className = "os-scroll-down os-scroll-down-hidden";
      btn.setAttribute("role", "button");
      btn.setAttribute("aria-label", "Scroll to bottom");
      btn.setAttribute("data-os-axis", axis);
      btn.innerHTML = SCROLL_DOWN_ICON;
      const ins = this._inset;
      Object.assign(btn.style, {
        bottom:
          ins.bottom === undefined || ins.bottom === "0" ? "2px" : `calc(${ins.bottom} + 2px)`,
        right: ins.right ?? "0",
        zIndex: String(this._zIndex + 1),
      });
      // Size the square button to the track width (matches `--os-hover`).
      btn.style.setProperty("--os-hover", `${this._hoverSize}px`);
      // A click scrolls the target straight back to the bottom (the scroll
      // event then lets the host re-engage auto-follow if it wants to).
      btn.addEventListener("click", (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this._target.scrollTop = this._target.scrollHeight;
      });
      this._container.appendChild(btn);
      this._axes[axis]!.scrollDown = btn;
    }

    thumb.addEventListener("pointerdown", (e: PointerEvent) => this._onThumbPointerDown(e, axis));
    track.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.target !== track) return;
      this._onTrackClick(e, axis);
    });
  }

  private _onThumbPointerDown(e: PointerEvent, axis: ScrollbarAxis): void {
    e.preventDefault();
    e.stopPropagation();
    const state = this._axes[axis];
    if (!state) return;
    state.thumb.classList.add("dragging");
    const rect = state.track.getBoundingClientRect();
    const startPos = axis === "vertical" ? e.clientY : e.clientX;
    const startScroll = axis === "vertical" ? this._target.scrollTop : this._target.scrollLeft;
    const onMove = (ev: PointerEvent) => {
      const cur = axis === "vertical" ? ev.clientY : ev.clientX;
      const trackLen = axis === "vertical" ? rect.height : rect.width;
      const thumbLen = axis === "vertical" ? state.thumb.offsetHeight : state.thumb.offsetWidth;
      const travel = trackLen - thumbLen;
      if (travel <= 0) return;
      const frac = (cur - startPos) / travel;
      const scrollLen =
        (axis === "vertical" ? this._target.scrollHeight : this._target.scrollWidth) -
        (axis === "vertical" ? this._target.clientHeight : this._target.clientWidth);
      const next = Math.max(0, Math.min(scrollLen, startScroll + frac * scrollLen));
      if (axis === "vertical") this._target.scrollTop = next;
      else this._target.scrollLeft = next;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      state.thumb.classList.remove("dragging");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  private _onTrackClick(e: PointerEvent, axis: ScrollbarAxis): void {
    e.preventDefault();
    const state = this._axes[axis];
    if (!state) return;
    const rect = state.track.getBoundingClientRect();
    const startPos = axis === "vertical" ? e.clientY : e.clientX;
    const trackLen = axis === "vertical" ? rect.height : rect.width;
    const thumbLen = axis === "vertical" ? state.thumb.offsetHeight : state.thumb.offsetWidth;
    const travel = trackLen - thumbLen;
    if (travel <= 0) return;
    const thumbPos =
      axis === "vertical"
        ? state.thumb.offsetTop - state.track.offsetTop
        : state.thumb.offsetLeft - state.track.offsetLeft;
    const frac = (startPos - state.track.offsetTop - thumbPos) / travel;
    const targetScroll =
      (axis === "vertical" ? this._target.scrollHeight : this._target.scrollWidth) -
      (axis === "vertical" ? this._target.clientHeight : this._target.clientWidth);
    const next = frac * targetScroll;
    if (axis === "vertical") this._target.scrollTop = Math.max(0, next);
    else this._target.scrollLeft = Math.max(0, next);
  }

  /** Recompute the thumb length + position from the current scroll geometry. */
  update(): void {
    if (this._destroyed) return;
    this._paintAxis("vertical");
    this._paintAxis("horizontal");
  }

  /** Update whether the scroll view is pinned to the bottom (auto-following
   *  the newest content). Shows the pin icon when true, hides it when false.
   *  The icon also hides when the scrollbar auto-hides. */
  setPinned(pinned: boolean): void {
    this._pinned = pinned;
    this._paintPin();
  }

  /** The pinned-state indicator element (vertical axis), or null if the
   *  `pinned` option wasn't set. Lets a host attach its own tooltip. */
  get pinElement(): HTMLElement | null {
    return this._axes["vertical"]?.pin ?? null;
  }

  /** The scroll-to-bottom control element (vertical axis), or null if the
   *  `scrollToBottom` option wasn't set. Lets a host attach its own tooltip. */
  get scrollDownElement(): HTMLElement | null {
    return this._axes["vertical"]?.scrollDown ?? null;
  }

  /** Show the scrollbar and cancel any pending auto-hide. */
  private _show(): void {
    if (!this._autoHide) return;
    this._setVisible(true);
    this._clearHideTimer();
  }

  /** Show on scroll activity, then re-arm the auto-hide timer. */
  private _poke(): void {
    if (!this._autoHide) return;
    this._setVisible(true);
    this._scheduleHide();
  }

  /** Start (or restart) the delay before fading out after the cursor leaves. */
  private _scheduleHide(): void {
    if (!this._autoHide) return;
    this._clearHideTimer();
    this._hideTimer = window.setTimeout(() => {
      this._hideTimer = 0;
      if (this._destroyed) return;
      // Keep it visible while the cursor is inside, or while the user is dragging.
      if (this._pointerInside || this._isDragging()) {
        this._setVisible(true);
        return;
      }
      this._setVisible(false);
    }, this._autoHideDelay);
  }

  private _setVisible(visible: boolean): void {
    this._visible = visible;
    for (const key of Object.keys(this._axes) as ScrollbarAxis[]) {
      const state = this._axes[key];
      if (state) state.track.classList.toggle("os-hidden", !visible);
    }
    this._paintPin();
  }

  /** Repaint the pin icon: hidden when the scrollbar is faded out (auto-hide)
   *  or when the view is not pinned to the bottom (or there is nothing to
   *  scroll). */
  private _paintPin(): void {
    const state = this._axes["vertical"];
    if (!state?.pin) return;
    const hidden = !this._visible || !this._pinned || state.track.style.display === "none";
    state.pin.classList.toggle("os-pin-hidden", hidden);
  }

  /** Repaint the scroll-to-bottom arrow: visible only while the vertical axis
   *  has overflow AND the view is not already at the bottom (there is
   *  somewhere to scroll back down to). Independent of the auto-hide fade so
   *  it stays available while the user is reading older messages. */
  private _paintScrollDown(): void {
    const state = this._axes["vertical"];
    if (!state?.scrollDown) return;
    const target = this._target;
    const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 2;
    const hidden = state.track.style.display === "none" || atBottom;
    state.scrollDown.classList.toggle("os-scroll-down-hidden", hidden);
  }

  private _isDragging(): boolean {
    for (const key of Object.keys(this._axes) as ScrollbarAxis[]) {
      const state = this._axes[key];
      if (state?.thumb.classList.contains("dragging")) return true;
    }
    return false;
  }

  private _clearHideTimer(): void {
    if (this._hideTimer) {
      window.clearTimeout(this._hideTimer);
      this._hideTimer = 0;
    }
  }

  private _paintAxis(axis: ScrollbarAxis): void {
    const state = this._axes[axis];
    if (!state) return;
    const { track, thumb } = state;
    if (axis === "vertical") {
      const viewport = this._target.clientHeight;
      const scrollLen = this._target.scrollHeight;
      const trackLen = track.clientHeight;
      if (scrollLen <= viewport) {
        thumb.style.display = "none";
        track.style.display = "none";
        this._paintPin();
        this._paintScrollDown();
        return;
      }
      thumb.style.display = "";
      track.style.display = "";
      const len = computeThumbLength(viewport, scrollLen, trackLen, this._minThumbSize);
      const pos = computeThumbPosition(this._target.scrollTop, scrollLen, viewport, trackLen, len);
      thumb.style.height = `${Math.max(this._minThumbSize, len)}px`;
      thumb.style.top = `${pos}px`;
      // The pin icon's visibility is driven by the host's pinned state (via
      // `setPinned`) and the scrollbar's own visibility (auto-hide/scroll).
      this._paintPin();
      this._paintScrollDown();
    } else {
      const viewport = this._target.clientWidth;
      const scrollLen = this._target.scrollWidth;
      const trackLen = track.clientWidth;
      if (scrollLen <= viewport) {
        thumb.style.display = "none";
        track.style.display = "none";
        return;
      }
      thumb.style.display = "";
      track.style.display = "";
      const len = computeThumbLength(viewport, scrollLen, trackLen, this._minThumbSize);
      const pos = computeThumbPosition(this._target.scrollLeft, scrollLen, viewport, trackLen, len);
      thumb.style.width = `${Math.max(this._minThumbSize, len)}px`;
      thumb.style.left = `${pos}px`;
    }
  }

  /** Clean up listeners, observers, and any wrapper we created. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._target.removeEventListener("scroll", this._onScroll);
    if (this._autoHide) {
      this._clearHideTimer();
      this._container.removeEventListener("pointerenter", this._onPointerEnter);
      this._container.removeEventListener("pointerleave", this._onPointerLeave);
    }
    this._ro?.disconnect();
    this._ro = null;
    this._mo?.disconnect();
    this._mo = null;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    for (const key of Object.keys(this._axes) as ScrollbarAxis[]) {
      const state = this._axes[key];
      if (state) {
        state.track.remove();
        state.pin?.remove();
        state.scrollDown?.remove();
      }
    }
    this._axes = {};
    this._target.removeAttribute("data-overlay-scrollbar");
    if (this._wrap && this._wrap.parentElement) {
      const parent = this._wrap.parentElement;
      parent?.insertBefore(this._target, this._wrap);
      this._wrap.remove();
    }
  }
}
