/**
 * FastDomNode — cached style wrapper for efficient DOM property access.
 *
 * Avoids style property string parsing by caching values as numbers
 * (pixels) and setting them directly on the DOM element's style object.
 */
export class FastDomNode {
  private _element: HTMLElement;

  constructor(element: HTMLElement) {
    this._element = element;
  }

  get element(): HTMLElement {
    return this._element;
  }

  setClassName(className: string): void {
    this._element.className = className;
  }

  setTop(top: number): void {
    this._element.style.top = `${top}px`;
  }

  setLeft(left: number): void {
    this._element.style.left = `${left}px`;
  }

  setWidth(width: number): void {
    this._element.style.width = `${width}px`;
  }

  setMinWidth(minWidth: string): void {
    this._element.style.minWidth = minWidth;
  }

  setHeight(height: number): void {
    this._element.style.height = `${height}px`;
  }

  setDisplay(display: string): void {
    this._element.style.display = display;
  }

  setVisibility(visible: boolean): void {
    this._element.style.visibility = visible ? "visible" : "hidden";
  }

  setPosition(position: string): void {
    this._element.style.position = position;
  }

  setInnerHTML(html: string): void {
    this._element.innerHTML = html;
  }

  setLineHeight(lineHeight: number): void {
    this._element.style.lineHeight = `${lineHeight}px`;
  }

  setZIndex(zIndex: number): void {
    this._element.style.zIndex = String(zIndex);
  }

  setTextAlign(align: string): void {
    this._element.style.textAlign = align;
  }

  setPaddingRight(padding: string): void {
    this._element.style.paddingRight = padding;
  }

  appendChild(child: FastDomNode | HTMLElement): void {
    this._element.appendChild(child instanceof FastDomNode ? child.element : child);
  }

  removeChild(child: FastDomNode | HTMLElement): void {
    this._element.removeChild(child instanceof FastDomNode ? child.element : child);
  }

  removeAllChildren(): void {
    this._element.textContent = "";
  }

  insertBefore(child: FastDomNode | HTMLElement, before: FastDomNode | HTMLElement): void {
    this._element.insertBefore(
      child instanceof FastDomNode ? child.element : child,
      before instanceof FastDomNode ? before.element : before,
    );
  }

  get scrollTop(): number {
    return this._element.scrollTop;
  }

  set scrollTop(value: number) {
    this._element.scrollTop = value;
  }

  get scrollLeft(): number {
    return this._element.scrollLeft;
  }

  set scrollLeft(value: number) {
    this._element.scrollLeft = value;
  }

  get scrollHeight(): number {
    return this._element.scrollHeight;
  }

  get clientHeight(): number {
    return this._element.clientHeight;
  }

  get clientWidth(): number {
    return this._element.clientWidth;
  }

  get offsetHeight(): number {
    return this._element.offsetHeight;
  }

  get offsetWidth(): number {
    return this._element.offsetWidth;
  }
}

/**
 * Create a FastDomNode wrapping a newly created HTMLDivElement.
 */
export function createFastDomNode(): FastDomNode {
  return new FastDomNode(document.createElement("div"));
}
