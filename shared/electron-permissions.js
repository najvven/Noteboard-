const protectedSessions = new WeakSet();

export function installPermissionDenyHandlers(webSession) {
  if (!webSession || protectedSessions.has(webSession)) return false;
  webSession.setPermissionCheckHandler(() => false);
  webSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  protectedSessions.add(webSession);
  return true;
}
