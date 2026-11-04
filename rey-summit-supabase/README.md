# Rey Summit — Supabase version

The PHP/MySQL backend is replaced by Supabase (Postgres + Auth + Storage). The site is now plain static files — no PHP server needed.

## Setup (about 10 minutes)

1. **Create a Supabase project**, then in the SQL Editor paste and run the single file `Database.sql` (tables → functions → sample data, all in one).
2. **Auth settings** (Authentication → Providers → Email / Sign In):
   - Turn **off "Confirm email"** (customers can log in right after registering).
   - Turn **off "Secure email change"** (so a customer's email change applies at once).
   - Set minimum password length to 8.
   - Authentication → URL Configuration: add your site URL (and `http://localhost/...` while testing) to **Redirect URLs** — password-reset emails need it.
3. **First admin**: Authentication → Users → *Add user* (tick Auto Confirm), then run the commented `insert into public.admins ...` at the very bottom of `Database.sql` with that email.
4. **Staff-account function** (needed for "Staff accounts" page create/delete):
   `supabase functions deploy admin-staff` (Supabase CLI; the service key is injected automatically).
5. **Connect the site**: put your Project URL and anon key in `supabase-config.js`.
6. Host the folder anywhere static (XAMPP `htdocs`, Netlify, GitHub Pages…). Open `index.html`.

## How it maps

| Old | New |
|---|---|
| `*.php` endpoints | `rsm_*` SQL functions (PART 2 of `Database.sql`), called through `supabase-api.js` (`rsmApi('x.php')` returns the same JSON as before, so page scripts barely changed) |
| PHP sessions / `password_hash` | Supabase Auth. Customers still log in by **username** (looked up to their email); admin & staff by email |
| `uploads/payment_proofs/` | private Storage bucket `payment-proofs` (5 MB, JPG/PNG/WebP); sales staff of the same branch see proofs via signed links |
| `*_password_resets` tables + `mail()` | Supabase password-reset emails |
| `sales_staff.php`, `delivery_staff.php` | `sales_staff.html`, `delivery_staff.html` |
| Admin branch picker (session) | stored in the browser (`localStorage`) |
| `delivery_address` with ` \| Contact \| Payment` appended | clean address + new `orders.contact_phone` column |

Dates and "today" use Asia/Manila time in the SQL functions.

## Things to know

- **Existing accounts / orders are not migrated.** Supabase can't read PHP password hashes the same way, so existing customers need to re-register or use "Forgot password" once their auth user exists. Test data can simply be re-created.
- Stock: place-order, counter sales and cart saving still validate against per-branch stock inside the database, same rules as before.
- I fixed filename-case mismatches (`login.js` vs `Login.js`, `customer_Register.html`) that worked on Windows but break on Linux hosting.
- The SQL and edge function were written without a live Supabase project to run against, so run through the flows once (register → order → staff approve → deliver) and tell me about anything that errors.
