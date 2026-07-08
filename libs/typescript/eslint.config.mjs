import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // Library-specific rules — keep simple for reuse
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",

      // Reasonable defaults for a shared library
      "prefer-const": "error",
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "curly": ["error", "all"],
    },
  },
  {
    ignores: ["dist/**/*", "node_modules/**/*"],
  }
);
