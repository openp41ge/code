/**
 * chrome-switches.ts — the Chromium switches the app starts with. Remote
 * debugging is for development only: its port lets any program on the
 * computer drive the app's windows, so a release build never opens it.
 */

/** [switch, value?] pairs, for `app.commandLine.appendSwitch`. */
export function chromeSwitches(packaged: boolean): Array<[string, string?]> {
  return [
    ["disable-features", "FontationsFontBackend"],
    ["enable-gpu-rasterization"],
    ...(packaged ? [] : [["remote-debugging-port", "9222"] as [string, string]]),
  ];
}
