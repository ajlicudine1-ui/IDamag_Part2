// Authentication now lives in sessionStorage, which is isolated per tab.
// It survives refreshes and is cleared automatically when that tab closes.
// The former five-minute close-tab grace period is intentionally disabled.
export const CLOSE_GRACE_PERIOD_MS = 0;

export function expireSessionAfterCloseGrace() {
  return false;
}

export function markAppClosed() {
  // Do not clear on pagehide: pagehide also fires during refresh/navigation.
  // Closing the tab clears its sessionStorage automatically.
}

export function clearPendingClose() {
  // No cross-tab pending-close flag is used with per-tab sessions.
}
