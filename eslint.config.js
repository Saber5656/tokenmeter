import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["test/fixtures/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        TextDecoder: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "no-control-regex": "off",
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
