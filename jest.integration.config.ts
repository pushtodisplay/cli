import type { Config } from "jest";

/**
 * Jest configuration for CLI integration tests.
 *
 * Usage:
 *   npm run test:integration
 *   # or directly:
 *   npx jest --config jest.integration.config.ts
 *
 * Requires backends running via ./scripts/start-test-backends.sh
 */
const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/integration/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  // Integration tests talk to real backends — give them more time
  testTimeout: 30_000,
};

export default config;
