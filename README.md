# MyPurePlan

An English-language scheduling and customer-management starter for UK window-cleaning businesses.

## What works in this connected starter

- Email/password sign-up and sign-in with Supabase Auth.
- First-run business workspace setup, creating an owner membership and default services.
- Supabase/PostgreSQL loading and saving for customers, property details, services, and appointments.
- Tenant-scoped Row Level Security (RLS) for business data.
- Responsive dashboard, calendar, customer directory, booking-request preview, reports and CSV export.
- A demo-only mode remains available when Supabase environment variables are not configured.

The public-facing booking preview is still an authenticated dashboard preview, not a deployed public booking system. Collision-safe public booking, email notifications and production-hardening are not included yet.

## 1. Create a Supabase project

1. Create a project in the Supabase dashboard.
2. Wait for the database to finish provisioning.
3. Open **SQL Editor** in the Supabase dashboard.
4. If your Supabase project is completely empty, open `supabase/migrations/001_initial_schema.sql`, copy it into SQL Editor and run it once. It creates the tables, RLS policies and the `create_business_for_current_user` function.
5. If you already ran part of the schema or see a message such as `type already exists`, do not run the whole script again. Instead, run the read-only query in `supabase/check_existing_setup.sql` and review any missing tables, RLS policies or functions before applying targeted fixes.

Use a fresh Supabase project for a clean installation. Do not run the initial schema over an existing app database without reviewing migration conflicts first.

## 2. Configure the app

1. In the Supabase dashboard, open **Project Settings → API** (the section may be called **API Keys** in newer dashboard versions).
2. Copy the **Project URL**.
3. Copy the project's **publishable** key, or its legacy **anon/public** key. Do not copy `service_role` or any secret key.
4. In the MyPurePlan project folder, make a copy of `.env.example` named `.env.local`.
5. Fill in the real values:

```env
VITE_SUPABASE_URL=https://your-real-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-public-publishable-key
```

Do not put quotation marks around the values. Do not share `.env.local` publicly. This project includes `.env.local` in `.gitignore`.

## 3. Start the app

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Since environment variables have changed, stop and restart the Vite server after creating or editing `.env.local`.

## 4. Create your login and workspace

1. Choose **Create an account** and register with your email and a strong password.
2. If Supabase asks for email verification, open the verification email, then return to the app and sign in.
3. Enter your business name to create your workspace.
4. Add a customer and appointment. The footer should report that changes were saved to Supabase.
5. Refresh the browser and sign in again to check that the records are still present.

## Security notes

- Never expose the Supabase `service_role` key in a browser app.
- Keep RLS enabled; do not create unrestricted public policies.
- Do not use real customer data until you have tested account recovery, tenant isolation, backups, and your privacy obligations.
- The dashboard currently synchronizes records to Supabase from the browser. Public booking needs server-side validation and collision-safe database logic before production use.

## Stack

- React + TypeScript + Vite
- Supabase Auth + PostgreSQL + Row Level Security
- Vercel-ready frontend
