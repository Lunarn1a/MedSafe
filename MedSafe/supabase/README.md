# MedSafe Supabase database setup

Run `setup.sql` once, in full, in the new MedSafe Supabase project's SQL Editor
as its default `postgres` role. It requires Supabase's existing `auth.users`,
`auth.uid()`, `anon`, and `authenticated` objects. It does not create passwords,
test accounts, or sample medicine records. Success returns:

```text
MedSafe database setup complete
```

The transaction creates `public.profiles`, `public.medicines`, and
`public.caregiver_links`, enables RLS, and grants only the required operations.
It intentionally fails if these tables already exist, rather than assuming an
unknown existing schema is compatible. On an error, run `ROLLBACK;` and inspect
the error; do not delete existing tables to retry. Re-running a successful setup
is unnecessary. Supabase Auth itself manages accounts and password hashes.

## Application integration

The browser now connects through `accounts.js`, `supabase-config.js`, and the
bundled Supabase client. The Python server serves these files but does not
handle passwords or hold an administrator key. Complete the dashboard settings
below before trying live signup and password recovery.

- After a confirmed user's first sign-in, insert their profile with `id` equal
  to the signed-in Auth UUID, a display name, and either `patient` or `caregiver`.
  Existing profiles should be read, not overwritten by a full-row upsert. A
  profile role is immutable through the app. Changing Auth user metadata does
  not change the profile role or data access. No admin role exists in this schema.
- Patients insert medicine rows with their own `patient_id`. The database sets
  record IDs, timestamps, and `created_by`; the client must omit those columns.
  Caregivers can write for a patient only when that patient granted `can_edit`.
  The app must validate medicine names against its existing reference and render
  all account/medicine text safely. User-entered regimen text is not a prescription.
- A caregiver can share their own profile UUID with a patient. The patient
  creates the link using their own ID and that caregiver ID. It is read-only by
  default; the patient may explicitly grant editing. Foreign keys enforce that
  the linked accounts have the correct roles. No public user directory or email
  lookup is provided. This is the initial consent workflow; an invitation-code
  interface can be added later without weakening the access rules.
- Either participant can delete a link. Once removed, the caregiver loses
  access on subsequent database requests. Information previously viewed or
  copied cannot be remotely erased; the UI must clear its local patient state.
- Caregivers can read the linked patient's profile and medicines. A patient
  can read their linked caregiver's profile. Other users cannot read them.
  Anonymous clients receive no access to these tables.
- This initial schema stores current medicine stock, not stock-change history,
  notifications, or reminder schedules. Those need separate features/migrations.
- The project URL and publishable key identify the app. Requests still need a
  signed-in user's access token for these policies. Never use a secret key to
  bypass the policies in browser code.

Keep `medsafe_private` outside the Data API's exposed schemas. Its narrow
security-definer helpers use fixed empty search paths and the current Auth user
to avoid recursive policies. They do not accept another user's identity as the
acting account. Access rules apply to app users; the project owner and other
privileged database administrators can manage database data.

## Remaining Supabase configuration

1. Under **Authentication → URL Configuration**, set the Site URL to
   `http://127.0.0.1:8000/`. Add these exact Redirect URLs:
   - `http://127.0.0.1:8000/`
   - `http://127.0.0.1:8000/?recovery=1`
   If testing the alternate server on port 8002, also add the equivalent two
   URLs with `8002`. Add exact URLs for any other port, `localhost` spelling,
   or hosted origin you actually use. Keep the local server running when
   opening a confirmation or reset link.
2. Ensure email/password signup is enabled and keep email confirmation enabled.
   The project was checked read-only during integration: signup was enabled,
   confirmations were required, and unsigned table reads were denied.
3. Configure **custom SMTP** for confirmation and password-reset messages to
   groupmates. Supabase's default sender only permits organization-team email
   addresses and has a small sending limit; being an app user or GitHub
   collaborator does not make someone a Supabase organization member.
   See the official SMTP guide below for provider setup. No provider password
   belongs in this repository or in browser code.
4. Restart MedSafe, create a Patient account, confirm the email, and sign in.
   Save a medicine and reload. In another browser, create a Caregiver account
   and sign in once. Copy its code and grant access from the patient account.
   Check view-only access, editing permission, and removal.
5. Request a password reset and open that link in the same browser that
   requested it (the app uses PKCE). Confirm the old password no longer works
   and the new one does. This manual check verifies actual email delivery,
   which the automated tests deliberately simulate.

No live project settings, accounts, or messages are created by adding these
files to Git. Existing browser-only demo records are not automatically
imported: they were not authenticated records. No changes to `setup.sql` are
needed after a successful initial run.

## Automated verification

`validation.json` records the initial 26 PostgreSQL access checks. The browser
test in `tests/` uses the real bundled SDK and PostgreSQL RLS with simulated
Auth and a small REST adapter. It tests account separation, persistence,
caregiver consent, editing, revocation, signup, reset, failure handling, and
logout. It creates no live accounts and sends no emails. See `tests/README.md`
for commands. These checks do not replace a live email/redirect test.

References:
- https://supabase.com/docs/guides/auth/managing-user-data
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth/auth-smtp
