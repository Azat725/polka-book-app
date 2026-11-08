import { afterEach, expect, it } from 'vitest';
import { installCompatibility } from './compat';
const original = Object.getOwnPropertyDescriptor(Promise, 'withResolvers');
afterEach(() => {
  if (original) Object.defineProperty(Promise, 'withResolvers', original);
});
it('provides resolve and reject capabilities on older WebView engines', async () => {
  Reflect.deleteProperty(Promise, 'withResolvers');
  installCompatibility();
  const factory = Reflect.get(Promise, 'withResolvers') as () => {
    promise: Promise<string>;
    resolve(value: string): void;
    reject(reason: Error): void;
  };
  const first = factory.call(Promise);
  first.resolve('readable');
  await expect(first.promise).resolves.toBe('readable');
  const second = factory.call(Promise);
  second.reject(new Error('failed'));
  await expect(second.promise).rejects.toThrow('failed');
});
it('preserves a native implementation', () => {
  const native = Reflect.get(Promise, 'withResolvers');
  installCompatibility();
  expect(Reflect.get(Promise, 'withResolvers')).toBe(native);
});
