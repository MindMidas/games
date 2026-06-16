import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["static", "node_modules"] },
  {
    files: ["src/client/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      globals: globals.browser,
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
);
