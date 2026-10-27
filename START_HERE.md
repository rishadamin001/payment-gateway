# PayBD Demo — Windows quick start

**DEMO MODE: fake money only. Never enter real card details, PINs or OTPs.**

1. Have **Node.js 24** installed and your existing **PostgreSQL** service running with database `payment_gateway` on port5432. No Docker is needed.
2. Extract the source ZIP into a **new folder**, preserving your previous project. Open the folder containing `start-demo.bat`.
3. **Double-click `start-demo.bat`.** It uses DATABASE_URL if already set in its process environment. Otherwise a hidden prompt asks for your connection URL, in this format: `postgresql://USER:PASSWORD@localhost:5432/payment_gateway`. Substitute your credentials and URL-encode password symbols (for example @ becomes %40). The value is not displayed or saved; no .env file is needed or read by the launcher.
4. Wait for **PayBD Demo ready**. First startup needs Internet to install locked dependencies. The launcher applies additive migrations and repeatable fictional seeds, then starts the API and website. Keep the terminal open.
5. The shop opens automatically. Otherwise enter **localhost:3001/shop**. Add products → Pay → choose a method → enter the displayed fake OTP **000000** → choose a simulated result. No SMS is sent.
6. Open **localhost:3001/merchant**, create your own fictional account with a new demo-only password (12+ characters), then click **Load fictional examples**. This populates your dashboards once without replacing records. Explore transactions, refunds, webhooks, payment links, invoices and finance.
7. Open **localhost:3001/admin**. On first use choose a separate administrator email/password. Approve or suspend merchants, inspect all transactions, risk hints and audit events. Classroom signups start active; suspension blocks new payments. Never show passwords or test API keys during your presentation.
8. Open **localhost:3001/architecture** and **localhost:3000/docs** for architecture and Swagger. Follow [the full click-through checklist](docs/CLICK_THROUGH.md) and [eight-minute demo script](docs/PRESENTATION.md).

**Stop:** Ctrl+C in the launcher terminal. Restart the same batch file; records and admin decisions remain. PDF/QR/CSV downloads use your browser's normal Downloads behavior. Links and QR codes default to localhost and work on the same laptop; another device requires a reachable deployment.

**Troubleshooting:** check Node24, PostgreSQL, the database name and free ports3000/3001. If DATABASE_URL is set in a PowerShell window, run `./start-demo.bat` from that window. Do not paste credentials into chat, files or shared logs. No real provider credentials are required.

**Optional automated verification:** stop the apps, provide DATABASE_URL and TEST_DATABASE_URL securely in the process environment (test URL must name a separate existing `payment_gateway_test` database), then run `npm run verify` from this folder. Normal demo startup needs no test database. Ask before creating any new database; tests never drop/reset data.

**Windows checks still outstanding:** native batch execution, hidden PowerShell prompt, browser auto-open, Downloads permissions, and Ctrl+C process cleanup. Cloud builds, database/API tests and Chromium browser checks are recorded under docs. Package installation may take longer on Windows; firewall/antivirus and occupied ports can affect startup.
