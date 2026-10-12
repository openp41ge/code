/**
 * The focus line on a tab handle: the focused tab (the active tab of the
 * focused cell or sidebar, while the window is focused; it is marked
 * `data-focused`) has a blue bar floating half above its top edge — 3px
 * thick with rounded ends, half the tab's width and centred.
 *
 * Half of it is outside the tab, and tab bars scroll sideways, which clips
 * anything outside them (as do the grid and its cells). So the line is not
 * drawn in the tab bar: it is one fixed element on the document's body,
 * placed over the focused tab. It follows the tab when anything around it
 * scrolls or resizes, and is clipped to the visible part of the tab's bar
 * (hidden when the tab is scrolled out of it).
 *
 * Every tab bar calls `syncFocusLine(this, root)` after it renders and
 * `focusLineLayer().hide(this)` when it is removed. The bar that shows the
 * line owns it; another bar's hide leaves it alone.
 */

const HEIGHT = 3;

export class FocusLineLayer {
  readonly element: HTMLElement;
  private _target: HTMLElement | null = null;
  private _owner: object | null = null;
  private _watched: Element[] = [];
  private _resize: ResizeObserver | null = null;
  private readonly _update = (): void => this.update();

  constructor(private readonly _doc: Document) {
    const el = _doc.createElement("div");
    el.className = "tab-focus-line";
    Object.assign(el.style, {
      position: "fixed",
      height: `${HEIGHT}px`,
      borderRadius: `${HEIGHT / 2}px`,
      background: "#4a9eff",
      pointerEvents: "none",
      zIndex: "100",
      display: "none",
    });
    this.element = el;
  }

  /** The tab the line is over (null: none). */
  get target(): HTMLElement | null {
    return this._target;
  }

  /** Show the line over `tab`, for `owner` (the tab bar). */
  show(tab: HTMLElement, owner: object): void {
    if (this._target !== tab) {
      this._unwatch();
      this._target = tab;
      this._watch(tab);
    }
    this._owner = owner;
    if (!this.element.isConnected) this._doc.body.appendChild(this.element);
    this.update();
  }

  /** Hide the line, if `owner` is showing it. */
  hide(owner: object): void {
    if (this._owner !== owner) return;
    this._unwatch();
    this._target = null;
    this._owner = null;
    this.element.style.display = "none";
  }

  /** Place the line over its tab again. */
  update(): void {
    const tab = this._target;
    if (!tab || !tab.isConnected) {
      this.element.style.display = "none";
      return;
    }
    const r = tab.getBoundingClientRect();
    let left = r.left + r.width / 4;
    let right = left + r.width / 2;
    // Clip to every ancestor that scrolls sideways (the tab's bar, the grid).
    for (const el of this._watched) {
      if (el.scrollWidth <= el.clientWidth) continue;
      const c = el.getBoundingClientRect();
      left = Math.max(left, c.left);
      right = Math.min(right, c.right);
    }
    const s = this.element.style;
    if (right <= left) {
      s.display = "none";
      return;
    }
    s.display = "block";
    s.left = `${left}px`;
    s.width = `${right - left}px`;
    s.top = `${r.top - HEIGHT / 2}px`;
  }

  /** Follow the tab: scrolling in any ancestor (scroll does not bubble), the
   *  window, and size changes of the tab and its ancestors. */
  private _watch(tab: HTMLElement): void {
    const view = this._doc.defaultView;
    const RO = view?.ResizeObserver;
    this._resize = RO ? new RO(this._update) : null;
    for (let el: Element | null = tab; el; el = parentOf(el)) {
      this._watched.push(el);
      el.addEventListener("scroll", this._update, { passive: true });
      this._resize?.observe(el);
    }
    view?.addEventListener("resize", this._update);
  }

  private _unwatch(): void {
    for (const el of this._watched) el.removeEventListener("scroll", this._update);
    this._watched = [];
    this._resize?.disconnect();
    this._resize = null;
    this._doc.defaultView?.removeEventListener("resize", this._update);
  }
}

/** An element's parent, continuing from a shadow root to its host. */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

const layers = new WeakMap<Document, FocusLineLayer>();

/** The document's focus line. */
export function focusLineLayer(doc: Document = document): FocusLineLayer {
  let layer = layers.get(doc);
  if (!layer) {
    layer = new FocusLineLayer(doc);
    layers.set(doc, layer);
  }
  return layer;
}

/** After a tab bar renders: show the line over its focused tab (the one
 *  marked `data-focused` in `root`), or hide it if the bar shows it. */
export function syncFocusLine(owner: object, root: ParentNode | null): void {
  const tab = root?.querySelector<HTMLElement>("[data-focused]") ?? null;
  if (tab) focusLineLayer().show(tab, owner);
  else focusLineLayer().hide(owner);
}
