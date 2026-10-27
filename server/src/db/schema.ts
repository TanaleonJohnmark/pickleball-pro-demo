/**
 * PICKLEBALL PRO — relational schema (PostgreSQL, Drizzle ORM).
 * Money is stored as integer centavos (e.g. ₱450.00 => 45000) to avoid
 * floating-point rounding errors. Times are timestamptz (UTC); club-local
 * operating hours are interpreted in the CLUB_TIMEZONE setting.
 */
import { relations, sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, jsonb,
  uniqueIndex, index, check,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['SUPER_ADMIN', 'CLUB_ADMIN', 'STAFF', 'COACH', 'PLAYER']);
export const accountStatusEnum = pgEnum('account_status', ['ACTIVE', 'SUSPENDED']);
export const skillEnum = pgEnum('skill_level', ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE']);
export const formatEnum = pgEnum('play_format', ['SINGLES', 'DOUBLES']);
export const courtStatusEnum = pgEnum('court_status', ['ACTIVE', 'INACTIVE']);
export const reservationStatusEnum = pgEnum('reservation_status', ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
export const paymentStatusEnum = pgEnum('payment_status', ['UNPAID', 'PENDING', 'PAID', 'REFUNDED', 'FAILED']);
export const membershipStatusEnum = pgEnum('membership_status', ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED']);
export const matchCategoryEnum = pgEnum('match_category', ['FRIENDLY', 'COMPETITIVE']);
export const matchStatusEnum = pgEnum('match_status', ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const scoringEnum = pgEnum('scoring_format', ['SIDE_OUT', 'RALLY']);
export const tournamentFormatEnum = pgEnum('tournament_format', ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'GROUP_KNOCKOUT']);
export const tournamentStatusEnum = pgEnum('tournament_status', ['DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const paymentMethodEnum = pgEnum('payment_method', ['CASH', 'GCASH_MANUAL', 'BANK_TRANSFER', 'CARD_TERMINAL', 'ONLINE']);
export const paymentPurposeEnum = pgEnum('payment_purpose', ['RESERVATION', 'MEMBERSHIP', 'TOURNAMENT', 'COACHING', 'OTHER']);
export const sessionKindEnum = pgEnum('session_kind', ['INDIVIDUAL', 'GROUP']);
export const coachingStatusEnum = pgEnum('coaching_status', ['SCHEDULED', 'COMPLETED', 'CANCELLED']);

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  role: roleEnum('role').notNull().default('PLAYER'),
  status: accountStatusEnum('status').notNull().default('ACTIVE'),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('users_role_idx').on(t.role)]);

export const sessions = pgTable('sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const playerProfiles = pgTable('player_profiles', {
  id: id(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  skillLevel: skillEnum('skill_level').notNull().default('BEGINNER'),
  preferredFormat: formatEnum('preferred_format').notNull().default('DOUBLES'),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
});

export const coaches = pgTable('coaches', {
  id: id(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  bio: text('bio'),
  hourlyRateCents: integer('hourly_rate_cents').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const courts = pgTable('courts', {
  id: id(),
  name: text('name').notNull().unique(),
  location: text('location').notNull(),
  surface: text('surface').notNull().default('Hard court'),
  indoor: boolean('indoor').notNull().default(false),
  capacity: integer('capacity').notNull().default(4),
  hourlyPriceCents: integer('hourly_price_cents').notNull(),
  status: courtStatusEnum('status').notNull().default('ACTIVE'),
  slotMinutes: integer('slot_minutes').notNull().default(30),
  minDurationMinutes: integer('min_duration_minutes').notNull().default(60),
  maxDurationMinutes: integer('max_duration_minutes').notNull().default(180),
  description: text('description'),
  photoUrl: text('photo_url'),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('courts_price_nonneg', sql`${t.hourlyPriceCents} >= 0`),
  check('courts_duration_valid', sql`${t.minDurationMinutes} > 0 AND ${t.maxDurationMinutes} >= ${t.minDurationMinutes}`),
]);

export const courtSchedules = pgTable('court_schedules', {
  id: id(),
  courtId: uuid('court_id').notNull().references(() => courts.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(), // 0 Sunday … 6 Saturday
  openTime: text('open_time').notNull(), // HH:MM club-local
  closeTime: text('close_time').notNull(),
}, (t) => [
  uniqueIndex('court_schedule_day_uq').on(t.courtId, t.dayOfWeek),
  check('court_schedule_dow', sql`${t.dayOfWeek} BETWEEN 0 AND 6`),
]);

export const courtMaintenance = pgTable('court_maintenance', {
  id: id(),
  courtId: uuid('court_id').notNull().references(() => courts.id, { onDelete: 'cascade' }),
  startAt: ts('start_at').notNull(),
  endAt: ts('end_at').notNull(),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
}, (t) => [index('maint_court_idx').on(t.courtId, t.startAt), check('maint_range', sql`${t.endAt} > ${t.startAt}`)]);

export const reservations = pgTable('reservations', {
  id: id(),
  reference: text('reference').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id),
  courtId: uuid('court_id').notNull().references(() => courts.id),
  createdById: uuid('created_by_id').notNull().references(() => users.id),
  startAt: ts('start_at').notNull(),
  endAt: ts('end_at').notNull(),
  participants: integer('participants').notNull(),
  basePriceCents: integer('base_price_cents').notNull(),
  discountCents: integer('discount_cents').notNull().default(0),
  totalPriceCents: integer('total_price_cents').notNull(),
  status: reservationStatusEnum('status').notNull().default('PENDING'),
  paymentStatus: paymentStatusEnum('payment_status').notNull().default('UNPAID'),
  notes: text('notes'),
  cancelReason: text('cancel_reason'),
  cancelledAt: ts('cancelled_at'),
  checkedInAt: ts('checked_in_at'),
  reminderSentAt: ts('reminder_sent_at'),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('res_court_start_idx').on(t.courtId, t.startAt),
  index('res_user_idx').on(t.userId),
  index('res_status_idx').on(t.status),
  check('res_range', sql`${t.endAt} > ${t.startAt}`),
  check('res_participants', sql`${t.participants} >= 1`),
]);
// NOTE: migration 0001 adds a GiST exclusion constraint that makes overlapping
// active reservations on the same court impossible at the database level.

export const reservationParticipants = pgTable('reservation_participants', {
  id: id(),
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
});

export const membershipPlans = pgTable('membership_plans', {
  id: id(),
  name: text('name').notNull().unique(),
  description: text('description'),
  priceCents: integer('price_cents').notNull(),
  durationDays: integer('duration_days').notNull(),
  discountPercent: integer('discount_percent').notNull().default(0),
  advanceBookingDays: integer('advance_booking_days').notNull().default(7),
  maxActiveBookings: integer('max_active_bookings').notNull().default(3),
  benefits: jsonb('benefits').$type<string[]>().notNull().default([]),
  renewable: boolean('renewable').notNull().default(true),
  minSkillLevel: skillEnum('min_skill_level'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [check('plan_discount', sql`${t.discountPercent} BETWEEN 0 AND 100`), check('plan_duration', sql`${t.durationDays} > 0`)]);

export const memberships = pgTable('memberships', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  planId: uuid('plan_id').notNull().references(() => membershipPlans.id),
  startDate: ts('start_date').notNull(),
  endDate: ts('end_date').notNull(),
  status: membershipStatusEnum('status').notNull().default('PENDING'),
  priceCents: integer('price_cents').notNull(),
  expiryNoticeSentAt: ts('expiry_notice_sent_at'),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index('membership_user_idx').on(t.userId, t.status)]);

export const matches = pgTable('matches', {
  id: id(),
  format: formatEnum('format').notNull(),
  category: matchCategoryEnum('category').notNull().default('FRIENDLY'),
  courtId: uuid('court_id').references(() => courts.id),
  startAt: ts('start_at').notNull(),
  endAt: ts('end_at').notNull(),
  status: matchStatusEnum('status').notNull().default('SCHEDULED'),
  scoring: scoringEnum('scoring').notNull().default('SIDE_OUT'),
  targetScore: integer('target_score').notNull().default(11),
  winBy: integer('win_by').notNull().default(2),
  bestOf: integer('best_of').notNull().default(1),
  liveState: jsonb('live_state'),
  winnerSide: integer('winner_side'),
  officialId: uuid('official_id').references(() => users.id),
  ratingApplied: boolean('rating_applied').notNull().default(false),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('match_start_idx').on(t.startAt), index('match_status_idx').on(t.status),
  check('match_bestof', sql`${t.bestOf} IN (1,3,5)`), check('match_winby', sql`${t.winBy} IN (1,2)`),
  check('match_target', sql`${t.targetScore} BETWEEN 5 AND 25`),
]);

export const matchParticipants = pgTable('match_participants', {
  id: id(),
  matchId: uuid('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  side: integer('side').notNull(),
}, (t) => [uniqueIndex('mp_uq').on(t.matchId, t.userId), index('mp_user_idx').on(t.userId), check('mp_side', sql`${t.side} IN (1,2)`)]);

export const matchScores = pgTable('match_scores', {
  id: id(),
  matchId: uuid('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  gameNumber: integer('game_number').notNull(),
  side1Score: integer('side1_score').notNull(),
  side2Score: integer('side2_score').notNull(),
  winnerSide: integer('winner_side'),
}, (t) => [uniqueIndex('ms_uq').on(t.matchId, t.gameNumber)]);

export const scoreHistory = pgTable('score_history', {
  id: id(),
  matchId: uuid('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason'),
  createdAt: createdAt(),
}, (t) => [index('sh_match_idx').on(t.matchId)]);

export const tournaments = pgTable('tournaments', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  startDate: ts('start_date').notNull(),
  endDate: ts('end_date').notNull(),
  venue: text('venue').notNull(),
  format: tournamentFormatEnum('format').notNull(),
  category: formatEnum('category').notNull(),
  skillDivision: skillEnum('skill_division'),
  feeCents: integer('fee_cents').notNull().default(0),
  maxParticipants: integer('max_participants').notNull(),
  registrationDeadline: ts('registration_deadline').notNull(),
  status: tournamentStatusEnum('status').notNull().default('DRAFT'),
  groupCount: integer('group_count').notNull().default(2),
  championTeamId: uuid('champion_team_id'),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [check('t_dates', sql`${t.endDate} >= ${t.startDate}`), check('t_max', sql`${t.maxParticipants} >= 2`)]);

export const tournamentTeams = pgTable('tournament_teams', {
  id: id(),
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  player1Id: uuid('player1_id').notNull().references(() => users.id),
  player2Id: uuid('player2_id').references(() => users.id),
  seed: integer('seed'),
  groupLabel: text('group_label'),
});

export const tournamentRegistrations = pgTable('tournament_registrations', {
  id: id(),
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  teamId: uuid('team_id').notNull().references(() => tournamentTeams.id, { onDelete: 'cascade' }),
  paymentStatus: paymentStatusEnum('payment_status').notNull().default('UNPAID'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('treg_uq').on(t.tournamentId, t.userId)]);

export const tournamentBrackets = pgTable('tournament_brackets', {
  id: id(),
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // ELIMINATION | ROUND_ROBIN
  stage: integer('stage').notNull().default(1),
});

export const tournamentMatches = pgTable('tournament_matches', {
  id: id(),
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
  bracketId: uuid('bracket_id').notNull().references(() => tournamentBrackets.id, { onDelete: 'cascade' }),
  round: integer('round').notNull(),
  position: integer('position').notNull(),
  team1Id: uuid('team1_id').references(() => tournamentTeams.id),
  team2Id: uuid('team2_id').references(() => tournamentTeams.id),
  winnerTeamId: uuid('winner_team_id').references(() => tournamentTeams.id),
  isBye: boolean('is_bye').notNull().default(false),
  nextMatchId: uuid('next_match_id'),
  nextSlot: integer('next_slot'),
  matchId: uuid('match_id').unique().references(() => matches.id),
}, (t) => [uniqueIndex('tm_pos_uq').on(t.bracketId, t.round, t.position)]);

export const rankings = pgTable('rankings', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  format: formatEnum('format').notNull(),
  rating: integer('rating').notNull().default(1000),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('rank_uq').on(t.userId, t.format), index('rank_fmt_idx').on(t.format, t.rating)]);

export const ratingHistory = pgTable('rating_history', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  matchId: uuid('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  format: formatEnum('format').notNull(),
  won: boolean('won').notNull(),
  delta: integer('delta').notNull(),
  ratingAfter: integer('rating_after').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('rh_uq').on(t.userId, t.matchId), index('rh_fmt_idx').on(t.format, t.createdAt)]);

export const coachingSessions = pgTable('coaching_sessions', {
  id: id(),
  coachId: uuid('coach_id').notNull().references(() => coaches.id),
  courtId: uuid('court_id').references(() => courts.id),
  title: text('title').notNull(),
  kind: sessionKindEnum('kind').notNull(),
  startAt: ts('start_at').notNull(),
  endAt: ts('end_at').notNull(),
  priceCents: integer('price_cents').notNull(),
  capacity: integer('capacity').notNull().default(1),
  status: coachingStatusEnum('status').notNull().default('SCHEDULED'),
  createdAt: createdAt(),
}, (t) => [index('cs_coach_idx').on(t.coachId, t.startAt), check('cs_range', sql`${t.endAt} > ${t.startAt}`)]);

export const coachingEnrollments = pgTable('coaching_enrollments', {
  id: id(),
  sessionId: uuid('session_id').notNull().references(() => coachingSessions.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => users.id),
  attended: boolean('attended'),
  paymentStatus: paymentStatusEnum('payment_status').notNull().default('UNPAID'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('ce_uq').on(t.sessionId, t.playerId)]);

export const coachNotes = pgTable('coach_notes', {
  id: id(),
  coachId: uuid('coach_id').notNull().references(() => coaches.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => users.id),
  note: text('note').notNull(),
  createdAt: createdAt(),
});

export const payments = pgTable('payments', {
  id: id(),
  reference: text('reference').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id),
  amountCents: integer('amount_cents').notNull(),
  method: paymentMethodEnum('method').notNull(),
  purpose: paymentPurposeEnum('purpose').notNull(),
  status: paymentStatusEnum('status').notNull().default('PAID'),
  externalRef: text('external_ref'),
  notes: text('notes'),
  reservationId: uuid('reservation_id').references(() => reservations.id),
  membershipId: uuid('membership_id').references(() => memberships.id),
  tournamentRegistrationId: uuid('tournament_registration_id').references(() => tournamentRegistrations.id),
  coachingEnrollmentId: uuid('coaching_enrollment_id').references(() => coachingEnrollments.id),
  recordedById: uuid('recorded_by_id').notNull().references(() => users.id),
  isSample: boolean('is_sample').notNull().default(false),
  paidAt: ts('paid_at').notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [index('pay_paid_idx').on(t.paidAt), index('pay_user_idx').on(t.userId), check('pay_amount', sql`${t.amountCents} > 0`)]);

export const refunds = pgTable('refunds', {
  id: id(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason').notNull(),
  processedById: uuid('processed_by_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [check('refund_amount', sql`${t.amountCents} > 0`)]);

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  readAt: ts('read_at'),
  createdAt: createdAt(),
}, (t) => [index('notif_user_idx').on(t.userId, t.readAt)]);

export const announcements = pgTable('announcements', {
  id: id(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  pinned: boolean('pinned').notNull().default(false),
  authorId: uuid('author_id').notNull().references(() => users.id),
  publishedAt: ts('published_at').notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  details: jsonb('details'),
  ip: text('ip'),
  createdAt: createdAt(),
}, (t) => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_created_idx').on(t.createdAt)]);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

/* ---------------- relations (used by db.query.*) ---------------- */
export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(playerProfiles, { fields: [users.id], references: [playerProfiles.userId] }),
  coach: one(coaches, { fields: [users.id], references: [coaches.userId] }),
  reservations: many(reservations, { relationName: 'owner' }),
  memberships: many(memberships),
  rankings: many(rankings),
}));
export const playerProfilesRelations = relations(playerProfiles, ({ one }) => ({ user: one(users, { fields: [playerProfiles.userId], references: [users.id] }) }));
export const coachesRelations = relations(coaches, ({ one, many }) => ({ user: one(users, { fields: [coaches.userId], references: [users.id] }), sessions: many(coachingSessions) }));
export const courtsRelations = relations(courts, ({ many }) => ({ schedules: many(courtSchedules), maintenance: many(courtMaintenance), reservations: many(reservations) }));
export const courtSchedulesRelations = relations(courtSchedules, ({ one }) => ({ court: one(courts, { fields: [courtSchedules.courtId], references: [courts.id] }) }));
export const courtMaintenanceRelations = relations(courtMaintenance, ({ one }) => ({ court: one(courts, { fields: [courtMaintenance.courtId], references: [courts.id] }) }));
export const reservationsRelations = relations(reservations, ({ one, many }) => ({
  user: one(users, { fields: [reservations.userId], references: [users.id], relationName: 'owner' }),
  court: one(courts, { fields: [reservations.courtId], references: [courts.id] }),
  guests: many(reservationParticipants),
}));
export const reservationParticipantsRelations = relations(reservationParticipants, ({ one }) => ({ reservation: one(reservations, { fields: [reservationParticipants.reservationId], references: [reservations.id] }) }));
export const membershipPlansRelations = relations(membershipPlans, ({ many }) => ({ memberships: many(memberships) }));
export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  plan: one(membershipPlans, { fields: [memberships.planId], references: [membershipPlans.id] }),
}));
export const matchesRelations = relations(matches, ({ one, many }) => ({
  court: one(courts, { fields: [matches.courtId], references: [courts.id] }),
  participants: many(matchParticipants),
  games: many(matchScores),
  history: many(scoreHistory),
}));
export const matchParticipantsRelations = relations(matchParticipants, ({ one }) => ({
  match: one(matches, { fields: [matchParticipants.matchId], references: [matches.id] }),
  user: one(users, { fields: [matchParticipants.userId], references: [users.id] }),
}));
export const matchScoresRelations = relations(matchScores, ({ one }) => ({ match: one(matches, { fields: [matchScores.matchId], references: [matches.id] }) }));
export const scoreHistoryRelations = relations(scoreHistory, ({ one }) => ({
  match: one(matches, { fields: [scoreHistory.matchId], references: [matches.id] }),
  actor: one(users, { fields: [scoreHistory.actorId], references: [users.id] }),
}));
export const tournamentsRelations = relations(tournaments, ({ many }) => ({ teams: many(tournamentTeams), brackets: many(tournamentBrackets), matches: many(tournamentMatches), registrations: many(tournamentRegistrations) }));
export const tournamentTeamsRelations = relations(tournamentTeams, ({ one }) => ({
  tournament: one(tournaments, { fields: [tournamentTeams.tournamentId], references: [tournaments.id] }),
  player1: one(users, { fields: [tournamentTeams.player1Id], references: [users.id], relationName: 'p1' }),
  player2: one(users, { fields: [tournamentTeams.player2Id], references: [users.id], relationName: 'p2' }),
}));
export const tournamentRegistrationsRelations = relations(tournamentRegistrations, ({ one }) => ({
  tournament: one(tournaments, { fields: [tournamentRegistrations.tournamentId], references: [tournaments.id] }),
  user: one(users, { fields: [tournamentRegistrations.userId], references: [users.id] }),
  team: one(tournamentTeams, { fields: [tournamentRegistrations.teamId], references: [tournamentTeams.id] }),
}));
export const tournamentBracketsRelations = relations(tournamentBrackets, ({ one, many }) => ({ tournament: one(tournaments, { fields: [tournamentBrackets.tournamentId], references: [tournaments.id] }), matches: many(tournamentMatches) }));
export const tournamentMatchesRelations = relations(tournamentMatches, ({ one }) => ({
  tournament: one(tournaments, { fields: [tournamentMatches.tournamentId], references: [tournaments.id] }),
  bracket: one(tournamentBrackets, { fields: [tournamentMatches.bracketId], references: [tournamentBrackets.id] }),
  team1: one(tournamentTeams, { fields: [tournamentMatches.team1Id], references: [tournamentTeams.id], relationName: 't1' }),
  team2: one(tournamentTeams, { fields: [tournamentMatches.team2Id], references: [tournamentTeams.id], relationName: 't2' }),
  match: one(matches, { fields: [tournamentMatches.matchId], references: [matches.id] }),
}));
export const rankingsRelations = relations(rankings, ({ one }) => ({ user: one(users, { fields: [rankings.userId], references: [users.id] }) }));
export const coachingSessionsRelations = relations(coachingSessions, ({ one, many }) => ({
  coach: one(coaches, { fields: [coachingSessions.coachId], references: [coaches.id] }),
  court: one(courts, { fields: [coachingSessions.courtId], references: [courts.id] }),
  enrollments: many(coachingEnrollments),
}));
export const coachingEnrollmentsRelations = relations(coachingEnrollments, ({ one }) => ({
  session: one(coachingSessions, { fields: [coachingEnrollments.sessionId], references: [coachingSessions.id] }),
  player: one(users, { fields: [coachingEnrollments.playerId], references: [users.id] }),
}));
export const paymentsRelations = relations(payments, ({ one, many }) => ({
  user: one(users, { fields: [payments.userId], references: [users.id] }),
  refunds: many(refunds),
}));
export const refundsRelations = relations(refunds, ({ one }) => ({ payment: one(payments, { fields: [refunds.paymentId], references: [payments.id] }) }));
export const notificationsRelations = relations(notifications, ({ one }) => ({ user: one(users, { fields: [notifications.userId], references: [users.id] }) }));
export const announcementsRelations = relations(announcements, ({ one }) => ({ author: one(users, { fields: [announcements.authorId], references: [users.id] }) }));
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({ actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }) }));
