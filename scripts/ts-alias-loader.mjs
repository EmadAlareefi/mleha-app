import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const projectRoot = process.cwd();

function tryResolveWithTsExtension(targetPath) {
  if (path.extname(targetPath)) {
    return targetPath;
  }
  return `${targetPath}.ts`;
}

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith('@/')) {
    const absolutePath = tryResolveWithTsExtension(
      path.join(projectRoot, specifier.slice(2))
    );
    return defaultResolve(pathToFileURL(absolutePath).href, context, defaultResolve);
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : projectRoot;
    const resolvedPath = tryResolveWithTsExtension(
      path.resolve(path.dirname(parentPath), specifier)
    );
    return defaultResolve(pathToFileURL(resolvedPath).href, context, defaultResolve);
  }

  return defaultResolve(specifier, context, defaultResolve);
}
