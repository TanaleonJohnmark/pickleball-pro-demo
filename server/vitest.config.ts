import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globalSetup: './tests/global-setup.ts', fileParallelism: false, testTimeout: 30000, hookTimeout: 60000, env: { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pickleball_test', CLIENT_ORIGIN: 'http://localhost:5173' } } });
