module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: [
    "xo",
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:import/typescript",
    "plugin:prettier/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: ["./tsconfig.json"],
  },
  plugins: [],
  rules: {
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-misused-promises": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/promise-function-async": "error",
    "@typescript-eslint/require-await": "error",
    "@typescript-eslint/return-await": ["error", "in-try-catch"],
    "import/order": [
      "error",
      {
        alphabetize: { order: "asc" },
        groups: ["builtin", "external", "parent", "sibling", "index", "type"],
        "newlines-between": "always",
      },
    ],
    "no-await-in-loop": "off",
    "new-cap": [
      "error",
      {
        capIsNewExceptions: [],
      },
    ],
    "no-constant-condition": ["error", { checkLoops: false }],
    "no-return-await": "off",
    "no-unused-vars": "off",
    "no-warning-comments": "off",
    "no-warning-capitalized-comments": "off",
    "capitalized-comments": "off",
    "no-unused-expressions": "off",
    "max-params": "off",
    "require-await": "off",
  },
  overrides: [
    {
      "files": ["test/hh/**/*.spec.ts"],
      "rules": {
        "max-nested-callbacks": "off"
      }
    }
  ]
};
