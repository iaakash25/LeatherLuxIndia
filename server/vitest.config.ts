import { defineConfig } from "vitest/config";

// Tests never read server/.env: every setting the app needs is pinned here, and the database is a
// throw-away embedded Postgres started by test/global-setup.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      MEDIA_DIR: "test/.media",
      LOG_LEVEL: "silent",
      DB_HOST: "127.0.0.1",
      DB_PORT: process.env["TEST_DB_PORT"] ?? "54329",
      DB_NAME: "llx_test",
      DB_USER: "postgres",
      DB_PASSWORD: "test-only-password",
      DB_SSL_MODE: "disable",
      JWT_ACCESS_SECRET: "test-jwt-secret-test-jwt-secret-0123456789",
      PASSWORD_PEPPER: "test-pepper-test-pepper-test-pepper-0123456789",
      CORS_ORIGINS: "https://shop.example.com",
      COOKIE_SECURE: "false",
      COOKIE_SAMESITE: "lax",
      RATE_LIMIT_AUTH_PER_15MIN: "1000",
      RATE_LIMIT_GLOBAL_PER_MIN: "10000",
      // Pinned like everything else: a developer's server/.env (which may close ordering before launch) must never reach the tests.
      ORDERS_OPEN: "true",
      RATE_LIMIT_STORE: "memory",
      SHIPPING_FREE_THRESHOLD_INR: "2500",
      SHIPPING_FLAT_INR: "150",
    },
  },
});
