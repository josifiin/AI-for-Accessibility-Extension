// Re-export of the canonical adapter, the same pattern as the other builtins
// here: one source of truth in the vendored @ai4a11y/tools package, resolved
// through this extension's provider utils by the pext build. It switches on
// the captions media already carries (native text tracks, or the player's CC
// button on YouTube and Vimeo); no model, no key. Edit the canonical file,
// not this one.
export * from '@ai4a11y/tools/adapters/show-captions.js';
