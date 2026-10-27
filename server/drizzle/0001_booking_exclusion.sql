-- Database-level guarantee against double booking.
-- Two active reservations on the same court can never overlap in time,
-- even if two requests arrive at the exact same moment.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_no_overlap"
  EXCLUDE USING gist ("court_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&)
  WHERE ("status" IN ('PENDING','CONFIRMED','CHECKED_IN'));
