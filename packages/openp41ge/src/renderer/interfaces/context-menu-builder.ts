/**
 * Context menu builder — builds context menu items for the grid.
 */

import type { ICommandBus } from "./command-bus";

export interface ContextMenuItem {
  label: string;
  action?: () => void;
  children?: ContextMenuItem[];
}

export interface IContextMenuBuilder {
  /** Initialize with dependencies. */
  init(commandBus: ICommandBus): void;

  /** Show a context menu at the given position for the given grid cell. */
  showContextMenu(
    x: number,
    y: number,
    row: number,
    col: number,
    gridEl: HTMLElement,
  ): Promise<void>;

  /** Hide the current context menu. */
  hideContextMenu(): void;
}
