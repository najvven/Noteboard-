/** Self-contained: Electron runs this function in the page's world before its scripts. */
export function protectCookies({ protectPopups }) {
  const protect = target => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(target.Document.prototype, 'cookie');
      if (descriptor?.configurable) Object.defineProperty(target.Document.prototype, 'cookie', { get() { return ''; }, set() {}, configurable: false });
      if (target.cookieStore) {
        const prototype = Object.getPrototypeOf(target.cookieStore);
        for (const [name, result] of [['get', null], ['getAll', null], ['set', undefined], ['delete', undefined]]) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
          if (descriptor?.configurable) Object.defineProperty(prototype, name, { value: () => Promise.resolve(name === 'getAll' ? [] : result), configurable: false, writable: false });
        }
      }
    } catch { /* Cross-origin frames receive their own sandboxed preload. */ }
  };
  protect(window);
  if (protectPopups) {
    const open = window.open;
    window.open = function (...args) {
      const popup = Reflect.apply(open, this, args);
      if (popup) protect(popup);
      return popup;
    };
  }
}
