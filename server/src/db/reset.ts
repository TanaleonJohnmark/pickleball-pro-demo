// DEVELOPMENT ONLY: drops every table so migrations can rebuild a clean database.
import { pool } from './index.js';
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database.');
await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;');
console.log('Database reset.');
await pool.end();
