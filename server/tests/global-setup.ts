import { execSync } from 'node:child_process';
export default function setup() {
  const url = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pickleball_test';
  process.env.DATABASE_URL = url;
  execSync('npx tsx src/db/reset.ts && npx tsx src/db/migrate.ts', { env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' }, stdio: 'inherit' });
}
