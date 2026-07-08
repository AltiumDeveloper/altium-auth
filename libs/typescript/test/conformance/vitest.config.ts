import { defineConfig } from "vitest/config";

// Separate config for the conformance suite so it stays fully isolated from the
// library's own unit tests (`src/index.test.ts`) and the default `npm test`.
// Run with: npm run test:conformance
export default defineConfig({
  test: {
    include: ["**/*.conformance.test.ts"],
    environment: "node",
  },
});
