#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');

// Support @/ alias resolution similar to Next.js
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const absoluteRequest = path.join(projectRoot, request.slice(2));
    return originalResolveFilename.call(this, absoluteRequest, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Lightweight TypeScript transpile to run .ts without ts-node/tsx
require.extensions['.ts'] = function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      esModuleInterop: true,
      resolveJsonModule: true,
      allowJs: true,
    },
    fileName: filename,
  });

  return module._compile(outputText, filename);
};

require('./remove-2026-erp-invoices.ts');
