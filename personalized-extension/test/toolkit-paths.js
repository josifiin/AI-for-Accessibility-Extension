// Where the toolkit sources live, for the static source checks in this
// directory.
//
// The toolkit is its own repository now. Its sources reach this one as the
// vendored @ai4a11y/toolkit package under node_modules, so a test that reads a
// toolkit file off disk has to resolve the package rather than walk up to a
// toolkit/ directory that no longer exists here. build.js locates the package
// the same way, through its ./package.json export.
//
// CommonJS on purpose, so both the .js tests (require) and the .mjs ones
// (createRequire(import.meta.url)) can use it.

const path = require('path');

const TOOLKIT_PKG_ROOT = path.dirname(require.resolve('@ai4a11y/toolkit/package.json'));

// Absolute path to a file inside the toolkit package, for example
// toolkitFile('registry', 'tools.js').
function toolkitFile(...segments) {
  return path.join(TOOLKIT_PKG_ROOT, ...segments);
}

module.exports = { TOOLKIT_PKG_ROOT, toolkitFile };
