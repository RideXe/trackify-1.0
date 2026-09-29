// maplibre-gl 6 starts its web worker from separate ES module files at runtime, which the Next.js
// bundle does not include. Copy them from the installed package into public/, under the library
// version, so route-map.tsx can point setWorkerUrl() at files that always match the bundled code.
// They are saved as .js because module workers require a JavaScript MIME type and every static
// host serves .js that way, while .mjs is not always mapped.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packageJson = require.resolve('maplibre-gl/package.json');
const { version } = JSON.parse(readFileSync(packageJson, 'utf8'));
const source = join(dirname(packageJson), 'dist');
const root = join(import.meta.dirname, '..', 'public', 'maplibre');
const target = join(root, version);

const worker = readFileSync(join(source, 'maplibre-gl-worker.mjs'), 'utf8');
const sharedImport = '"./maplibre-gl-shared.mjs"';
if (!worker.includes(sharedImport))
  throw new Error(
    `maplibre-gl ${version} worker no longer imports ${sharedImport}; update this script`,
  );

rmSync(root, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
writeFileSync(
  join(target, 'maplibre-gl-worker.js'),
  worker.replace(sharedImport, '"./maplibre-gl-shared.js"'),
);
writeFileSync(
  join(target, 'maplibre-gl-shared.js'),
  readFileSync(join(source, 'maplibre-gl-shared.mjs')),
);
