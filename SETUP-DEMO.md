# Pickleball Pro by JT — Live Demo site

A public demo for your Facebook page. Court owners can try the booking system with one click — no sign-up.

**What visitors see**
- **Try as a player** → creates a temporary guest account and opens the booking page.
- **Try as the court owner** → opens the owner dashboard, calendar, front desk, payments and reports.
- Booking features only (matches, tournaments, rankings, coaching and memberships are switched off in `client/brand.json` → `features`).
- A yellow banner: "Live demo… resets in Xh" with a **Get this for your court** button that links to your page.
- 4 sample courts with a month of bookings and payments, rebuilt automatically every **6 hours**. Guest accounts and anything visitors changed are wiped at each reset.

**Your private login**: `ADMIN_EMAIL` / `ADMIN_PASSWORD` (super admin, recreated after every reset). Demo accounts cannot change passwords.

---

## Put it online (same steps as AizuGeorge)

1. **GitHub** → create a new **private** repository named `pickleball-pro-demo` (no README).
2. In VS Code, open this folder (the one with `render.yaml`), then in the terminal:
   ```
   git init
   git add .
   git commit -m "Pickleball Pro demo"
   git branch -M main
   git remote add origin https://github.com/TanaleonJohnmark/pickleball-pro-demo.git
   git push -u origin main
   ```
3. **Render** → **New → Blueprint** → pick `pickleball-pro-demo` → fill in:
   | Key | Value |
   |---|---|
   | `DEMO_CONTACT_URL` | Your page link, e.g. `https://m.me/yourpagename` (opens Messenger) or your Facebook page URL |
   | `ADMIN_NAME` | Johnmark Tanaleon |
   | `ADMIN_EMAIL` | your email |
   | `ADMIN_PASSWORD` | a strong password (8+ characters, a letter and a number) |
4. **Deploy Blueprint** → wait until **Live** → your demo link is shown, e.g. `https://pickleball-pro-demo.onrender.com`.
5. Put that link on your Facebook page: **Edit page → Website**, and in your posts: “Try it yourself: [link]”.

Free plan note: the site sleeps after ~15 minutes without visitors; the first visit then takes ~50 seconds. The sample data resets when it wakes up if 6 hours have passed.

## Try it on your laptop first (optional)

1. pgAdmin → create database `ppdemo`.
2. ```
   npm run install:all
   copy server\.env.example server\.env
   ```
   Edit `server\.env` (your PostgreSQL password, ADMIN_EMAIL/ADMIN_PASSWORD).
3. ```
   npm run db:migrate --prefix server
   npm run dev:server
   npm run dev:client
   ```
   Open http://localhost:5173. The sample club is created automatically on first start.

## Change things
- Reset more or less often: `DEMO_RESET_HOURS` in Render (e.g. `24`).
- Show a feature again (e.g. tournaments): set it to `true` in `client/brand.json` → `features`, commit and push.
