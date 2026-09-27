const protectedSessions = new WeakMap();

export function installPermissionDenyHandlers(webSession, options) {
  if (!webSession) return false;
  const existing = protectedSessions.get(webSession);
  if (existing) {
    if (options?.allowFullscreen !== undefined) existing.allowFullscreen = options.allowFullscreen === true;
    return false;
  }
  const policy = { allowFullscreen: options?.allowFullscreen === true };
  const allowed = permission => permission === 'fullscreen' && policy.allowFullscreen;
  webSession.setPermissionCheckHandler((_webContents, permission) => allowed(permission));
  webSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowed(permission));
  });
  protectedSessions.set(webSession, policy);
  return true;
}
