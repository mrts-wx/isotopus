const fs = require('node:fs');
const path = require('node:path');

const entry = path.join(__dirname, '..', 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');
const patched = 'import * as __WEBPACK_EXTERNAL_MODULE_sharp__ from "../../../../src/main/runtime/sharp-stub.mjs";';

if (!fs.existsSync(entry)) {
  throw new Error('Transformers.js Node entry was not found. Install the locked npm dependencies before starting/building.');
}

const source = fs.readFileSync(entry, 'utf8');
if (source.includes(patched)) process.exit(0);
const importPattern = /import \* as __WEBPACK_EXTERNAL_MODULE_sharp__ from "(?:sharp|(?:\.\.\/)+sharp-stub\.mjs)";/;
if (!importPattern.test(source)) {
  throw new Error('Transformers.js changed its Sharp import. Review the Electron compatibility patch before building.');
}
fs.writeFileSync(entry, source.replace(importPattern, patched));
