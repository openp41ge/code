/**
 * File Viewer app type registration.
 *
 * Creates FileEditorController panes backed by the <file-editor> web component.
 * The file path is received through tab.config.filePath, set via restore()
 * before mount() is called (from the actionOpenFile workspace command).
 */

import type { AppTypeRegistration } from "../../controllers/types";
import { FileEditorController } from "./file-editor-controller";

export const fileViewerAppRegistration: AppTypeRegistration = {
  id: "file-viewer",
  label: "File Viewer",
  icon: "\uD83D\uDCC4",
  description: "View file contents",
  createController: (tabId: string) => new FileEditorController(tabId, "file-viewer"),
};
