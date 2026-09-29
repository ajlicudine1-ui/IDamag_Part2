const PENDING_CLOSE_KEY = "idamag_pending_close_at";
const SESSION_VERSION_KEY = "idamag_auth_version";
const USER_KEY = "user";

export const CLOSE_GRACE_PERIOD_MS = 5 * 60 * 1000;

export function expireSessionAfterCloseGrace() {
  const pendingCloseAt = Number(
    sessionStorage.getItem(PENDING_CLOSE_KEY)
  );

  if (!pendingCloseAt) return false;

  sessionStorage.removeItem(PENDING_CLOSE_KEY);

  if (Date.now() - pendingCloseAt >= CLOSE_GRACE_PERIOD_MS) {
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(SESSION_VERSION_KEY);
    return true;
  }

  return false;
}

export function markAppClosed() {
  if (sessionStorage.getItem(USER_KEY)) {
    sessionStorage.setItem(PENDING_CLOSE_KEY, String(Date.now()));
  }
}

export function clearPendingClose() {
  sessionStorage.removeItem(PENDING_CLOSE_KEY);
}
