/**
 * autofocus-directive.ts — a lit element directive that focuses its element
 * once it is mounted.
 */

import { directive, Directive } from "lit/directive.js";
import type { ElementPart } from "lit/directive.js";

/** Focus the inline URL editor the moment it is mounted. The grid surface
 *  renders into a container that may not yet be attached to the document, so
 *  focus can only take effect once the element is connected — poll briefly. */
class AutofocusDirective extends Directive {
  private timer: number | undefined;
  render(): unknown {
    return undefined;
  }
  update(part: ElementPart): unknown {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    const el = part.element as HTMLElement;
    if (el.isConnected) {
      el.focus();
      return undefined;
    }
    let tries = 0;
    const id = window.setInterval(() => {
      if (el.isConnected) {
        el.focus();
        window.clearInterval(id);
        this.timer = undefined;
      } else if (++tries > 100) {
        window.clearInterval(id);
        this.timer = undefined;
      }
    }, 10);
    this.timer = id;
    return undefined;
  }
}
export const autofocus = directive(AutofocusDirective);
