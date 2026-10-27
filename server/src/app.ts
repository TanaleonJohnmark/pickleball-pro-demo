import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { errorHandler } from './lib/http.js';
import { loadUser, csrfGuard } from './lib/auth.js';
import { r as auth } from './routes/auth.js';
import { r as courtsR } from './routes/courts.js';
import { r as reservationsR } from './routes/reservations.js';
import { r as playersR } from './routes/players.js';
import { plans, r as membershipsR } from './routes/memberships.js';
import { r as matchesR } from './routes/matches.js';
import { r as tournamentsR } from './routes/tournaments.js';
import { r as rankingsR } from './routes/rankings.js';
import { r as paymentsR } from './routes/payments.js';
import { r as coachingR } from './routes/coaching.js';
import { r as notificationsR, ann } from './routes/notifications.js';
import { r as reportsR } from './routes/reports.js';
import { r as dashboardR } from './routes/dashboard.js';
import { r as adminR } from './routes/admin.js';
import { r as publicR } from './routes/public.js';
import { demoRouter } from './demo.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], scriptSrc: ["'self'"] } } }));
  const origins = (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false, credentials: true }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 100000 : 300, standardHeaders: true, legacyHeaders: false }));
  app.use('/api', csrfGuard, loadUser);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth);
  app.use('/api/public', publicR);
  app.use('/api/demo', demoRouter);
  app.use('/api/courts', courtsR);
  app.use('/api/reservations', reservationsR);
  app.use('/api/players', playersR);
  app.use('/api/membership-plans', plans);
  app.use('/api/memberships', membershipsR);
  app.use('/api/matches', matchesR);
  app.use('/api/tournaments', tournamentsR);
  app.use('/api/rankings', rankingsR);
  app.use('/api/payments', paymentsR);
  app.use('/api/coaching', coachingR);
  app.use('/api/notifications', notificationsR);
  app.use('/api/announcements', ann);
  app.use('/api/reports', reportsR);
  app.use('/api/dashboard', dashboardR);
  app.use('/api/admin', adminR);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } }));

  // In production the server also serves the built React app.
  const dist = path.resolve(process.cwd(), '../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
