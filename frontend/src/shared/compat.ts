// PDF.js 6 assumes this capability even in its legacy build. Install in both realms.
export function installCompatibility() {
  if (typeof Reflect.get(Promise, 'withResolvers') === 'function') return;
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function <T>(this: PromiseConstructor) {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new this<T>((accept, decline) => {
        resolve = accept;
        reject = decline;
      });
      return { promise, resolve, reject };
    },
  });
}
installCompatibility();
