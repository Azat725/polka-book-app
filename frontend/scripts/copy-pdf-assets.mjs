import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  const target = resolve('public/pdfjs', name);
  await mkdir(target, { recursive: true });
  await cp(resolve('node_modules/pdfjs-dist', name), target, { recursive: true });
}
const licenses = resolve('public/licenses');
await mkdir(licenses, { recursive: true });
for (const name of [
  '@fontsource/golos-text',
  '@fontsource/unbounded',
  'pdfjs-dist',
  'three',
  'react',
  'react-dom',
  'lucide-react',
  'i18next',
  'react-i18next',
  '@tanstack/react-query',
  '@tanstack/query-core',
]) {
  const directory = resolve('node_modules', name);
  const files = await readdir(directory);
  const license = files.find((file) => /^licen[sc]e(\.(md|txt))?$/i.test(file));
  if (!license) throw new Error(`Missing distribution license for ${name}`);
  await writeFile(
    resolve(licenses, `${name.replaceAll('/', '-').replace('@', '')}.txt`),
    await readFile(resolve(directory, license)),
  );
}
