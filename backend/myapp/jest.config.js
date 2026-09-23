module.exports = {
  moduleNameMapper: {
    "^@readeverywhere/epub-core/keywords$": "<rootDir>/test/epub-core-keywords-native.cjs",
    "^@readeverywhere/epub-core$": "<rootDir>/test/epub-core-native.cjs",
    "^@readeverywhere/epub-core/node$": "<rootDir>/test/epub-core-node-native.cjs",
  },
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  setupFilesAfterEnv: ["<rootDir>/test/setup-storage.ts"],
  testEnvironment: "node",
};
