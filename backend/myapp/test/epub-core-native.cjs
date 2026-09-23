// Jest's CJS VM does not implement Node 24 require(ESM). Use the real runtime
// loader so these tests exercise the shipped package and its real worker.
const { createRequire } = process.getBuiltinModule('module');
module.exports = createRequire(__filename)('@readeverywhere/epub-core');
