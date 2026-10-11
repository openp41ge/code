import type { IContextMenuBuilder } from "../interfaces/context-menu-builder";
import type { ICommandBus } from "../interfaces/command-bus";
import { isTabGrid } from "../interfaces/element-guards";
import { setContextMenuActive } from "./drag-context";

export class ContextMenuBuilder implements IContextMenuBuilder {
  private _commandBus: ICommandBus | null = null;

  init(commandBus: ICommandBus): void {
    this._commandBus = commandBus;
  }

  async showContextMenu(
    x: number,
    y: number,
    _row: number,
    _col: number,
    gridEl: HTMLElement,
  ): Promise<void> {
    if (!isTabGrid(gridEl)) return;
    const winId = gridEl.winId;
    const dispatch = this._commandBus!.dispatch.bind(this._commandBus);

    const items: Array<{ label: string; id: string }> = [
      { label: "Split right", id: "split" },
      { label: "Equalize column widths", id: "equalize" },
      { label: "---", id: "sep1" },
      { label: "Add workset", id: "add-workset" },
      { label: "---", id: "sep2" },
      { label: "Quit", id: "quit" },
    ];

    setContextMenuActive(true);

    const id = await window.openp41ge.showContextMenu(items);
    setTimeout(() => setContextMenuActive(false), 0);
    if (!id) return;

    switch (id) {
      case "split":
        window.openp41ge.workspace.cmdNewColumn();
        break;
      case "equalize": {
        const cols = gridEl.cols;
        if (cols > 0) {
          dispatch("resizeGrid", winId, winId, 1, cols);
        }
        break;
      }
      // add-workset removed — no more worksets
      case "quit":
        window.openp41ge.window.close();
        break;
    }
  }

  hideContextMenu(): void {
    const menus = document.querySelectorAll("openp41ge-contextmenu");
    for (const m of menus) m.remove();
  }
}
