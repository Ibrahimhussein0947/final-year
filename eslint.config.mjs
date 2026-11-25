import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/uploads*/**",
      "apps/mobile/**",
      "apps/ai/**",
      "apps/web/public/**",
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      // Existing findings are kept visible as warnings and fixed gradually.
      "no-useless-escape": "warn",
      "no-irregular-whitespace": "warn",
      "no-useless-assignment": "warn",
      "no-control-regex": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["apps/api/**/*.ts", "apps/web/scripts/**", "*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
);
