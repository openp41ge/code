/**
 * openp41ge-core-terminal — Terminal emulator web component wrapping xterm.js.
 *
 * Exports the <openp41ge-terminal> custom element class, shell connectors,
 * and built-in themes.
 */

export { Openp41geTerminal, registerOpenp41geTerminal } from "./ui/openp41ge-terminal";
export type { TerminalDataHandler, Openp41geTerminalOptions } from "./ui/openp41ge-terminal";

export type { ShellConnector } from "./shell";
export { IpcShellConnector, NodePtyConnector } from "./shell";
export type { NodePtyConnectorOptions } from "./shell";

export {
  THEME_DARK,
  THEME_LIGHT,
  THEME_DRACULA,
  THEME_GITHUB_DARK,
  BUILT_IN_THEMES,
} from "./themes";
