/**
 * Extension registration at bootstrap: fetch the active extensions from main,
 * load each one's renderer entry (which self-registers its surfaces, see
 * services/extension-renderer-loader.ts), and load them again whenever the
 * set of active extensions changes (install, update, reload).
 */

import {
  onExtensionsChanged,
  refreshActiveExtensions,
} from "../../services/extension-contributions";
import { registerRendererExtensions } from "../../services/extension-renderer-loader";

/** Load the active extensions' renderer entries now and on every change.
 *  Called once at bootstrap. */
export async function registerExtensionsWithRefresh(): Promise<void> {
  await refreshActiveExtensions();
  await registerRendererExtensions();
  onExtensionsChanged(() => void registerRendererExtensions());
}
