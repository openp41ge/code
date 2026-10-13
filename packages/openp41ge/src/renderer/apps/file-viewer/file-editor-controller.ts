/**
 * FileEditorController — adapter that bridges <file-editor> to Openp41ge's tab system.
 *
 * Implements FileViewerController (a TabController subtype) with file-specific
 * properties like loadFile, filePath, and isDirty.
 *
 * The preview/pinned state is managed by the Openp41ge platform via tab.isPreview
 * in the workspace state. This controller reads it for behavior decisions
 * (e.g., showing pin UI) but never decides WHEN to preview or pin.
 */

import { createLogger } from "openp41ge-core-logger";
import { BaseController } from "../../controllers/base-controller";
import type { FileViewerController } from "../../controllers/types";
import { shouldOpenFile, DEFAULT_EDITOR_MAX_FILE_SIZE } from "../../models/file-size-gate";

const log = createLogger("openp41ge", "FileEditorController");

// Import the file-editor component (side-effect: defines <file-editor>)
import "openp41ge-sdk-uikit/file-editor";
import type { FileEditorElement } from "openp41ge-sdk-uikit/file-editor";
import {
  ExtensionFormatterRegistry,
  registerBuiltinFormatters,
} from "openp41ge-sdk-uikit/file-editor";
import type { IFormatter } from "openp41ge-sdk-uikit/file-editor";
import { appServices } from "../../app";
import {
  editorFontSize,
  editorLineHeight,
  editorSetting,
  isEditorSettingsKey,
} from "../../services/editor-settings";

/** Built-in JSON formatter (pretty-print). */
const jsonFormatter: IFormatter = {
  name: "JSON Pretty Print",
  format(content: string): string {
    try {
      return JSON.stringify(JSON.parse(content), null, 2) + "\n";
    } catch (err) {
      log.debug("FileEditorController json format failed; leaving content:", err);
      return content;
    }
  },
};

/** Singleton formatter registry with built-in formatters. */
let _formatterRegistry: ExtensionFormatterRegistry | null = null;
function getFormatterRegistry(): ExtensionFormatterRegistry {
  if (!_formatterRegistry) {
    _formatterRegistry = new ExtensionFormatterRegistry();
    _formatterRegistry.register(["json", "jsonc"], jsonFormatter);
    registerBuiltinFormatters(_formatterRegistry);
  }
  return _formatterRegistry;
}

export class FileEditorController extends BaseController implements FileViewerController {
  /** Full file path on disk. */
  filePath: string = "";

  /** Whether there are unsaved changes. Read by app.ts helper functions. */
  _isDirty: boolean = false;

  /** The <file-editor> element, or null until mount(). */
  private _editor: FileEditorElement | null = null;

  /** Tracks the last dispatched title to deduplicate updateTabTitle calls. */
  private _lastDispatchedTitle: string = "";

  /** Bound event listeners for cleanup. */
  private _boundTitleChanged: ((e: Event) => void) | null = null;
  private _boundDirtyChanged: ((e: Event) => void) | null = null;
  private _boundFileSaved: ((e: Event) => void) | null = null;
  private _boundConfigChanged: ((e: Event) => void) | null = null;

  constructor(tabId: string, appType: string, filePath?: string) {
    super(tabId, appType);
    if (filePath) {
      this.filePath = filePath;
      this.state.filePath = filePath;
    }
  }

  mount(container: HTMLElement): void {
    this.container = container;

    // File path is already set by restore() from tab.config.filePath
    // before mount() is called. Do NOT use window.__pendingFilePath —
    // it races with concurrent file opens and overrides the correct path.
    const fileName = this.filePath.split("/").filter(Boolean).pop() || "Untitled";

    // Layout
    container.style.cssText = [
      "width:100%",
      "height:100%",
      "display:flex",
      "flex-direction:column",
      "background:var(--bg-surface)",
      "overflow:hidden",
      "position:relative",
    ].join(";");

    // Create <file-editor>
    const editor = document.createElement("file-editor") as FileEditorElement;
    editor.style.cssText = "width:100%;height:100%;display:block;";
    editor.formatterRegistry = getFormatterRegistry();
    container.appendChild(editor);
    this._editor = editor;

    // Apply editor settings from config
    this._applyEditorTheme();
    this._applyEditorSettings();

    // Bridge CustomEvents to Openp41ge
    this._attachEventBridge();

    // Load the file using the shared model from the registry
    // (async — mount returns synchronously; file content loads in background)
    if (this.filePath) {
      this._loadFileAsync(this.filePath, fileName);
    }
  }

  /**
   * Wait for the editor's Lit lifecycle to complete (firstUpdated)._viewportEl
   * must be created before loadFile can render lines.
   */
  private async _awaitEditorReady(): Promise<void> {
    const editor = this._editor;
    if (!editor) return;
    // _viewportEl is private on FileEditorElement; access via bracket cast
    type _EditorWithPrivates = { _viewportEl?: HTMLElement; updateComplete: Promise<void> };
    const e = editor as unknown as _EditorWithPrivates;
    // If _viewportEl is already set by firstUpdated(), no need to wait
    if (e._viewportEl) return;
    // Wait for Lit's updateComplete which resolves after firstUpdated()
    if (typeof e.updateComplete?.then === "function") {
      await e.updateComplete;
    }
  }

  /**
   * Async file loading using the shared model from the registry.
   * Called from mount() to keep the mount() signature synchronous.
   */
  private async _loadFileAsync(path: string, fileName: string): Promise<void> {
    if (!this._editor) return;
    try {
      // Ensure the editor's Lit lifecycle has completed (firstUpdated)
      // so _viewportEl is available before loadFile() is called.
      await this._awaitEditorReady();

      // Size gate BEFORE any read: files over editor/file.maxFileSize open the tab
      // with a "too large" message instead of loading content into a model.
      // No bytes are read for oversized files, so the renderer never blocks on
      // a huge readRange.
      const limit = editorSetting(appServices.configService, "file", "maxFileSize") as
        number | undefined;
      const stat = window.openp41ge?.file?.stat ? await window.openp41ge.file.stat(path) : null;
      if (!shouldOpenFile(stat?.size, limit)) {
        this._editor.showTooLarge(path, stat!.size, limit ?? DEFAULT_EDITOR_MAX_FILE_SIZE);
        return;
      }

      const model = await appServices.modelRegistry.getOrCreate(path);
      if (!this._editor) return; // Already unmounted
      this._editor.textContentModel = model;

      // Cross-tab sync is automatic: all tabs share the same model instance,
      // so model.onDidChangeContent listeners in each tab fire for all edits.
      // The editor's _initWithModel already subscribes to model content changes.

      await this._editor.loadFile(path, fileName);

      // Apply any externally-provided search highlight carried on the tab
      // config (e.g. the Git sidebar's current query).
      this._applyConfiguredHighlight();
    } catch (err) {
      // A file that fails to load (too large, unreadable) is recoverable — the
      // editor shows an inline message. Log it as an ERROR with `skipToast` so
      // it carries correct severity without tripping the error capture.
      log.error("Failed to mount file:", err, { skipToast: true });
    }
  }

  /**
   * If the tab was opened with a `search` payload (git commit search), tell the
   * editor to highlight matches of that query in the just-loaded buffer.
   */
  private _applyConfiguredHighlight(): void {
    const search = (this.state.search ?? undefined) as
      { query?: string; regex?: boolean; caseSensitive?: boolean } | undefined;
    const matchIndex =
      typeof this.state.matchIndex === "number" ? this.state.matchIndex : undefined;
    if (search?.query && this._editor) {
      this._editor.setSearchHighlight(
        search.query,
        {
          regex: search.regex,
          caseSensitive: search.caseSensitive,
        },
        matchIndex,
      );
    }
    // Reveal a specific content-search match instance (Explorer).
    const line = this.state.line;
    if (typeof line === "number" && this._editor) {
      const column = this.state.column;
      this._editor.revealLine(line, typeof column === "number" ? column : undefined);
    }
  }

  unmount(): void {
    this._detachEventBridge();

    // Release the shared model from the registry
    if (this.filePath) {
      appServices.modelRegistry.release(this.filePath);
    }

    this._editor = null;
    this.container = null;
    this._lastDispatchedTitle = "";
  }

  setVisible(visible: boolean): void {
    // Forward tab activation/deactivation to the editor element. An inactive
    // file editor pauses all rendering work (see FileEditorElement.setActive);
    // it resumes with a refresh when the tab becomes active again. Streaming/
    // terminal tab types keep their own (or no-op) visibility handling.
    if (this._editor) {
      this._editor.setActive(visible);
    }
  }

  snapshot(): Record<string, unknown> {
    return {
      ...this.state,
      filePath: this.filePath,
    };
  }

  restore(state: Record<string, unknown>): void {
    this.state = { ...state };
    if (typeof state.filePath === "string") {
      this.filePath = state.filePath;
    }
  }

  /**
   * Load a new file into this existing tab.
   * Called when a preview tab is replaced with a new file.
   */
  loadFile(path: string, fileName?: string): Promise<void> {
    const prevPath = this.filePath;
    this.filePath = path;
    this.state.filePath = path;

    if (path !== prevPath) {
      // Release the previous model, and drop any search highlight that belonged
      // to the previous buffer (a different file must not show stale matches).
      if (prevPath) {
        appServices.modelRegistry.release(prevPath);
      }
      this._editor?.clearSearchHighlight();

      queueMicrotask(() => {
        try {
          window.openp41ge.workspace.dispatch("updateTabConfig", this.tabId, "filePath", path);
        } catch (err) {
          log.debug("FileEditorController updateTabConfig(filePath) dispatch failed:", err);
          // Ignore dispatch errors
        }
      });
    }

    if (this._editor) {
      const name = fileName || path.split("/").filter(Boolean).pop() || "Untitled";
      return this._loadFileAsync(path, name);
    }

    return Promise.resolve();
  }

  /**
   * Reveal a 1-based line/column on this file. Called when an Explorer
   * content-search match row is clicked for a file that's already open: it
   * moves the cursor there and (optionally) highlights the search query. If
   * the editor isn't mounted yet, the position/highlight are recorded on
   * state and applied by _applyConfiguredHighlight on mount.
   */
  revealLine(
    line: number,
    column?: number,
    search?: { query: string; regex?: boolean; caseSensitive?: boolean },
    matchIndex?: number,
  ): void {
    this.state.line = line;
    if (column !== undefined) {
      this.state.column = column;
    }
    if (search?.query) {
      this.state.search = search;
      if (typeof matchIndex === "number") {
        this.state.matchIndex = matchIndex;
      }
      this._editor?.setSearchHighlight(
        search.query,
        {
          regex: search.regex,
          caseSensitive: search.caseSensitive,
        },
        matchIndex,
      );
    }
    if (this._editor) {
      this._editor.revealLine(line, column);
    }
  }

  /**
   * Save the current content to disk.
   */
  async saveDraft(): Promise<boolean> {
    if (!this._editor) return false;
    return this._editor.save();
  }

  // ── Private helpers ──

  /** Apply the editor syntax theme. Uses a single consistent theme for all files. */
  private _applyEditorTheme(): void {
    if (!this._editor) return;
    const themeId = appServices.configService.getSyntaxTheme();
    this._editor.setTheme(themeId);
  }

  /** Apply the file editor's settings from config (`editor/file`, else
   *  `editor/*`): line height, font size, word wrap and the save cleanup. */
  private _applyEditorSettings(): void {
    if (!this._editor) return;
    const config = appServices.configService;
    const lineHeight = editorLineHeight(config, "file");
    const fontSize = editorFontSize(config, "file");
    if (lineHeight !== undefined) this._editor.setEditorLineHeight(lineHeight);
    if (fontSize !== undefined) this._editor.setEditorFontSize(fontSize);
    // Word-wrap default: applied to files without a per-file override;
    // per-file choices are remembered per path.
    this._editor.setWordWrapDefault(editorSetting(config, "file", "wordWrap") === true);
    // What a save tidies first: both on unless set to false.
    this._editor.setSaveCleanup({
      trimTrailingWhitespace: editorSetting(config, "file", "trimTrailingWhitespace") !== false,
      insertFinalNewline: editorSetting(config, "file", "insertFinalNewline") !== false,
    });
  }

  private _attachEventBridge(): void {
    if (!this._editor) return;

    this._boundTitleChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const title: string = detail.title ?? "";
      if (title === this._lastDispatchedTitle) return;
      this._lastDispatchedTitle = title;
      try {
        window.openp41ge.workspace.dispatch("updateTabTitle", this.tabId, title);
      } catch (err) {
        log.debug("FileEditorController updateTabTitle dispatch failed:", err);
        // Ignore dispatch errors during teardown
      }
    };

    this._boundDirtyChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const wasDirty = this._isDirty;
      this._isDirty = !!detail.isDirty;

      // Propagate dirty state to the tab config so the tab handle can show
      // a visual indicator (yellow circle) next to the close button.
      try {
        window.openp41ge.workspace.dispatch(
          "updateTabConfig",
          this.tabId,
          "isDirty",
          this._isDirty,
        );
      } catch (err) {
        log.debug("FileEditorController updateTabConfig(isDirty) dispatch failed:", err);
        // Ignore dispatch errors during teardown
      }

      // Auto-pin the tab when it becomes dirty for the first time.
      // An unpinned (preview) tab becomes pinned once modified, since
      // pinned tabs cannot be unpinned — they can only be closed.
      if (this._isDirty && !wasDirty && this.container) {
        // The platform's grid-pin handler finds the tab by window.
        this.container.dispatchEvent(
          new CustomEvent("grid-pin", {
            bubbles: true,
            composed: true,
            detail: {
              winId: window.openp41ge.workspace.getWindowId(),
              tabId: this.tabId,
              pinned: true,
            },
          }),
        );
      }
    };

    this._boundFileSaved = (_e: Event) => {
      try {
        window.openp41ge.workspace.dispatch(
          "updateTabConfig",
          this.tabId,
          "filePath",
          this.filePath,
        );
      } catch (err) {
        log.debug("FileEditorController updateTabConfig(filePath saved) dispatch failed:", err);
        // Ignore dispatch errors during teardown
      }
    };

    this._boundConfigChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string; value?: unknown };
      if (!detail || !detail.key) return;
      // React to editor config changes (any `editor/` section).
      if (isEditorSettingsKey(detail.key)) this._applyEditorSettings();
    };

    // Listen for config changes to update syntax theme
    document.addEventListener("openp41ge:config-changed", this._boundConfigChanged);

    this._editor.addEventListener("fe:title-changed", this._boundTitleChanged);
    this._editor.addEventListener("fe:dirty-changed", this._boundDirtyChanged);
    this._editor.addEventListener("fe:file-saved", this._boundFileSaved);
  }

  private _detachEventBridge(): void {
    if (!this._editor) return;
    if (this._boundTitleChanged)
      this._editor.removeEventListener("fe:title-changed", this._boundTitleChanged);
    if (this._boundDirtyChanged)
      this._editor.removeEventListener("fe:dirty-changed", this._boundDirtyChanged);
    if (this._boundFileSaved)
      this._editor.removeEventListener("fe:file-saved", this._boundFileSaved);
    if (this._boundConfigChanged)
      document.removeEventListener("openp41ge:config-changed", this._boundConfigChanged);
    this._boundTitleChanged = null;
    this._boundDirtyChanged = null;
    this._boundFileSaved = null;
    this._boundConfigChanged = null;
  }
}
