#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');

// Resolve @/ aliases similar to Next.js/tsconfig paths
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const absoluteRequest = path.join(projectRoot, request.slice(2));
    return originalResolveFilename.call(this, absoluteRequest, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Minimal TypeScript transpiler so we can require .ts files without ts-node
require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2017,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  });
  module._compile(result.outputText, filename);
};

// Now require the actual TypeScript script
require('./fetch-salla-statuses.ts');
