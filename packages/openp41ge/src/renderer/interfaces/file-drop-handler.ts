/**
 * File drop handler — manages file-tree drag-and-drop onto the grid.
 *
 * Handles dragover, dragleave, and drop events from the file tree,
 * determining whether to add the file to an existing cell or split
 * the grid to create a new cell.
 */

import type { ICommandBus } from "./command-bus";

export interface IFileDropHandler {
  /** Initialize with required dependencies. */
  init(commandBus: ICommandBus): void;

  /** Handle dragover event on the grid. */
  handleDragOver(e: DragEvent, gridEl: HTMLElement): void;

  /** Handle dragleave event on the grid. */
  handleDragLeave(e: DragEvent, gridEl: HTMLElement): void;

  /** Handle drop event on the grid. Opens the dropped file. */
  handleDrop(e: DragEvent, gridEl: HTMLElement): void;
}
