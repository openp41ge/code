/**
 * Layout operations — barrel file.
 *
 * Re-exports all operations from domain-specific modules for backward
 * compatibility. Import paths like "layout/operations" continue to work.
 */

export * from "./common.js";
export * from "./grid-operations.js";
export * from "./tab-operations.js";
export * from "./window-operations.js";
export * from "./file-operations.js";
export * from "./cell-operations.js";
export * from "./serialization.js";
export * from "./system-tab-operations.js";
