let tailwindPostcssPlugin = null;

try {
  // Optional dependency: keep dev server running even if this package is not installed.
  // If installed, Tailwind v4 transformations will be enabled.
  tailwindPostcssPlugin = require("@tailwindcss/postcss");
} catch (error) {
  tailwindPostcssPlugin = null;
}

const plugins = [];

if (tailwindPostcssPlugin) {
  plugins.push(tailwindPostcssPlugin());
}

plugins.push(require("autoprefixer")());

module.exports = {
  plugins,
};
