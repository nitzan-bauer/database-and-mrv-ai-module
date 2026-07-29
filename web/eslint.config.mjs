import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships flat config directly, so it is spread in as-is.
 * The FlatCompat bridge this file used to carry is for the legacy .eslintrc
 * shape; against this version it threw "Converting circular structure to
 * JSON" and lint could not run at all.
 */
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", ".tsbuild/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
