# Account browser tests

These development tests are optional when running the app. They use isolated
simulated Auth accounts, the actual bundled Supabase SDK, and an in-memory
PostgreSQL database running the real `setup.sql` policies. A small HTTP
adapter simulates PostgREST. No live Supabase account, email, or record is used.
Actual email delivery and hosted Auth configuration still require a manual test.

Install Node.js and Microsoft Edge for this test harness. Start the Python
server on port 8002 from the repository root:

```powershell
.\MedSafe\backend\.venv\Scripts\python.exe .\MedSafe\backend\server.py --port 8002
```

In a second terminal, from this test directory:

```powershell
npm install
npm test
```

`MEDSAFE_TEST_URL` may point to another local port. `MEDSAFE_TEST_BROWSER` may
point to another Chromium-based browser executable. For environments with
preinstalled modules, `MEDSAFE_TEST_PGLITE` and `MEDSAFE_TEST_PLAYWRIGHT` may
point to their JavaScript module entry files.

Results and screenshots go into ignored `test-output/`. Auth callback tests
exercise PKCE code exchange with simulated tokens, not real email links.
