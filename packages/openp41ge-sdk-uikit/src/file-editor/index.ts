/**
 * openp41ge-file-editor — Self-contained file editor web component.
 *
 * Re-exports the <file-editor> web component and re-exports the editor
 * engine from openp41ge-core-editor-engine.
 */

export { FileEditorElement } from "../components/file-editor/file-editor";
export type { FileEditorState } from "../components/file-editor/file-editor";

// Re-export everything from the editor engine package
export * from "openp41ge-core-editor-engine";
