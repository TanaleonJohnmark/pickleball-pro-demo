import 'dotenv/config';
import { createApp } from './app.js';
import { runJobs } from './jobs.js';
import { setupClub } from './db/setup-club.js';
import { resetDemoIfDue } from './demo.js';

await setupClub().catch((e) => console.error('setup-club failed:', e.message));
await resetDemoIfDue().catch((e) => console.error('demo reset failed:', e.message));

const port = Number(process.env.PORT || 4000);
createApp().listen(port, () => console.log(`Pickleball Pro API on http://localhost:${port}`));
const tick = () => resetDemoIfDue().then(runJobs).catch((e) => console.error('job error', e));
setTimeout(tick, 5000);
setInterval(tick, 10 * 60 * 1000);
