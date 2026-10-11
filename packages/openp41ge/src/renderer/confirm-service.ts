/**
 * confirm-service — renderer-side confirmation helper.
 *
 * A thin wrapper over the preload `confirm` bridge. Calling `showConfirm`
 * requests a native confirm dialog window (owned by the main process), which
 * is centred over the calling window. The calling window is masked + disabled
 * until the user answers.
 *
 * This replaces the retired in-window `<openp41ge-confirm-modal>`.
 */

export interface ShowConfirmOptions {
  message: string;
  title?: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmStyle?: string;
  checkboxLabel?: string;
  checkboxDetail?: string;
}

/**
 * Show a confirmation as a native dialog window over this window's centre.
 * Resolves `true`/`false` from the user's answer; any failure resolves `false`.
 */
export async function showConfirm(options: ShowConfirmOptions): Promise<boolean> {
  const bridge = (
    window as unknown as {
      openp41ge?: {
        confirm?: {
          show: (o: ShowConfirmOptions) => Promise<{ confirmed: boolean; checked: boolean }>;
        };
      };
    }
  ).openp41ge?.confirm;
  if (!bridge) return false;
  try {
    const result = await bridge.show(options);
    return !!result?.confirmed;
  } catch {
    return false;
  }
}

/** Confirm with an opt-in checkbox; resolves the checked state too. */
export async function showConfirmChecked(
  options: ShowConfirmOptions & { checkboxLabel: string },
): Promise<{ confirmed: boolean; checked: boolean }> {
  const bridge = (
    window as unknown as {
      openp41ge?: {
        confirm?: {
          show: (o: ShowConfirmOptions) => Promise<{ confirmed: boolean; checked: boolean }>;
        };
      };
    }
  ).openp41ge?.confirm;
  if (!bridge) return { confirmed: false, checked: false };
  try {
    return (await bridge.show(options)) ?? { confirmed: false, checked: false };
  } catch {
    return { confirmed: false, checked: false };
  }
}
