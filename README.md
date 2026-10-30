# Food Ordering Web Application

This project is a simple web-based food ordering system designed for small and medium food businesses in Zimbabwe. It follows the system proposal described in the project document and includes three main user interfaces:

- Customer ordering page
- Restaurant order management page
- Delivery tracking page

## Features

- Browse restaurant menu items
- Add foods to a shopping cart
- Place customer orders
- Track order status updates and receive in-app messages as the order progresses
- Opt in to browser notifications for order receipt, preparation, and pickup readiness while the customer page is open
- Mark pickup orders as collected so they no longer remain pending
- Restaurant dashboard to manage incoming orders
- Delivery dashboard to mark orders as ready/out for delivery/delivered
- Staff login and admin dashboard
- Admin-approved clients can charge orders to a monthly account; administrators can generate month-end statements and record payments
- Admin revenue card tracks collected orders for the current local day and resets at the next local midnight
- Admins and cashiers can add received stock or remove used stock from the stock controls; each movement is audited and removals cannot reduce inventory below zero
- Placed customer orders automatically deduct ordered quantities from stock, and admin and cashier inventory refreshes every 12 seconds
- Diet Monitoring highlights an hourly activity check-in and prompts the signed-in student while the page is open
- Diet Monitoring explains nutrition estimates and suggests meal ideas based on each student's non-cancelled orders from the last 30 days
- Diet Monitoring includes general wellbeing tips for balanced meals, hydration, movement, and rest
- Diet Monitoring explains how to log eaten meals and adjust servings for nutrition estimates
- Students can connect Fitbit to view daily steps and resting heart rate in Diet Monitoring
- Students can request password reset links by email; administrators can assign recovery email addresses to existing student accounts

## Tech Stack

- Node.js
- Express.js
- Neon PostgreSQL (with MySQL and SQLite support for existing local setups)
- HTML, CSS, and JavaScript

## Database Setup

The app uses Neon PostgreSQL when `DATABASE_URL` is configured. Otherwise, it
tries MySQL and falls back to the local SQLite database at
`data/food-ordering-app.db`. The downloaded `food-ordering-app.db` database is
imported there for local use; the original download and older database files
are left untouched.

### Neon PostgreSQL (recommended)

1. Create a Neon project and database in the Neon console.
2. Copy the connection string from Neon. Use the pooled connection string for
   a deployed app, and keep the URL private.
3. Set it as `DATABASE_URL` in the environment used to start the app:

   ```powershell
   $env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require"
   npm.cmd start
   ```

   Replace the example with your actual Neon connection string; do not commit it
   or paste it into source files. `.env.example` documents the variable, but the
   app does not load `.env` files automatically.

The app creates and updates its tables on startup and seeds the initial menu and
admin account if needed. Existing records in SQLite or MySQL are not copied to
Neon automatically; export and migrate them separately if you need to preserve
them. If `DATABASE_URL` is unset, the app continues to use the existing MySQL
then SQLite behavior.

### Fitbit activity and heart-rate data

Create a Fitbit Web API application and configure its callback URL to exactly
match `FITBIT_REDIRECT_URI`, for example
`https://your-app.onrender.com/api/diet/fitbit/callback`. Add these environment
variables to Render (and use a matching local URL when testing locally):

- `FITBIT_CLIENT_ID`
- `FITBIT_CLIENT_SECRET`
- `FITBIT_REDIRECT_URI`
- `FITBIT_TOKEN_ENCRYPTION_KEY` — use a persistent random secret with at least
  32 characters. Keep it private and do not change it after students connect,
  because it encrypts their stored Fitbit tokens.

The app requests Fitbit's `activity` and `heartrate` permissions. Students
connect from Diet Monitoring and can remove the saved connection there. The
dashboard reads Fitbit's daily steps total and daily resting-heart-rate
summary; resting heart rate is not a live pulse reading. Fitbit data may be
unavailable until a compatible device has synced. Never use these estimates for
medical monitoring or diagnosis.

To migrate the current SQLite database to an empty Neon database, first stop
the app, set `DATABASE_URL` to your Neon connection string, and run:

```powershell
$env:DATABASE_URL = "your-new-Neon-connection-string"
npm.cmd run migrate:neon
```

By default, the migration reads `data/food-ordering-app.db`; set
`SQLITE_DB_PATH` first if your current database is elsewhere. The migration
preserves row IDs and related records, including orders, account activity,
feedback, diet-monitoring data, and encrypted Fitbit connections; checks row
counts; and stops if it finds existing data in the Neon tables rather than
overwriting it. Keep the same `FITBIT_TOKEN_ENCRYPTION_KEY` configured when
migrating connected Fitbit accounts. User account
password hashes are included so migrated accounts can continue to sign in.
Keep the connection string private, and rotate it if it has been shared.

To copy only current stock quantities from SQLite into an already-used Neon
database, set `DATABASE_URL` and preview the changes first:

```powershell
npm.cmd run sync:stock:neon
```

The preview matches menu items by name and refuses to proceed if names are
missing or ambiguous. If the preview is correct, apply it with:

```powershell
npm.cmd run sync:stock:neon -- --apply
```

This updates only `menu_items.stock_quantity`; it does not change Neon orders,
accounts, or stock-movement history. By default, the source is
`data/food-ordering-app.db`; set `SQLITE_DB_PATH` if the stock data is in a
different SQLite file.

To use a different SQLite database file, set `SQLITE_DB_PATH` before starting
the app. For example, in PowerShell:

```powershell
$env:SQLITE_DB_PATH = "C:\path\to\your\database.db"
npm.cmd start
```

When using VS Code's **Start app and open Login** launch configuration, the
project-local `data/food-ordering-app.db` is used by default.

### MySQL (optional)

To use MySQL instead, open MySQL Workbench or your MySQL command line and create the database:

1. Open MySQL Workbench or your MySQL command line.
2. Create the database:

   CREATE DATABASE food_ordering_db;

3. Set your connection values before running the app:

   $env:DB_HOST = "localhost"
   $env:DB_PORT = "3306"
   $env:DB_USER = "root"
   $env:DB_PASSWORD = "your_mysql_password"
   $env:DB_NAME = "food_ordering_db"

4. Set these environment variables in the same terminal session you use to start the app. The application does not load `.env` files automatically.

## Run the Project

1. Open a terminal in this project folder.
2. Install dependencies:

   npm install

3. Start the app:

   npm start

4. Open your browser at:

   http://localhost:3000

## Project Pages

- Login page: http://localhost:3000/
- Customer home page: http://localhost:3000/home.html
- Restaurant dashboard: http://localhost:3000/restaurant.html
- Delivery dashboard: http://localhost:3000/delivery.html
- Admin dashboard: http://localhost:3000/admin.html

## Database

The app creates the required tables automatically on first run if the database connection is valid.

## Admin security

- The admin account uses the username `admin`. The insecure `admin123` password is no longer used: on first startup, the app generates a strong one-time password and prints it in the server terminal. Copy it before closing the terminal. You can instead set `ADMIN_PASSWORD` to a unique password of at least 16 characters before the first startup (or while the old default is being replaced).
- Sign in at `http://localhost:3000/admin-login.html` and change the generated password immediately from **Change Admin Password** on the admin dashboard. Choose a unique password of at least 14 characters.
- Admin pages and APIs require a signed, eight-hour, HttpOnly session. The server checks the account's current role and password on protected requests; browser storage alone does not grant access.
- Set `SESSION_SECRET` to a securely generated value when deploying, and use HTTPS in production so the session cookie is only sent over secure connections.

PowerShell examples (set the values before `npm.cmd start`):

```powershell
$env:ADMIN_PASSWORD = "replace-with-a-unique-password-of-at-least-16-characters"
$env:SESSION_SECRET = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm.cmd start
```

`ADMIN_PASSWORD` is only used to create an admin account or replace the insecure legacy default; it does not overwrite a password that has already been changed.
Use HTTPS when deploying beyond a trusted local development network.

## Monthly client billing

Administrators can approve registered clients for monthly billing from **Admin
Panel → Account directory → Clients**. Approved clients see **Charge to Monthly
Account** at checkout, and their outstanding monthly balance appears with their
student-credit balance. Other clients cannot select or submit monthly billing.

At month-end, open **Admin Panel → Monthly Billing**, select a completed month,
and choose **Generate Statements**. Statements include collected or delivered
monthly-account orders that have not already been invoiced; cancelled or
unfinished orders are excluded. Generate again after any late-completed orders
are finalized to add them to an unpaid statement. Use **Mark as paid** only
after payment is received. Existing unpaid statements and their order history
are retained in the database.

## Student password reset

The login page's **Forgot password?** link lets students request a one-hour, single-use reset link by email or, when configured, WhatsApp. Reset tokens are stored as hashes, and resetting a password signs out that student's existing sessions.

New student registrations must provide an email address. To set a recovery address for an existing student, open **Admin Panel → Account directory**, choose **Clients**, enter the student's email in the **Recovery email** column, and save it. The administrator must confirm the address with the student.

Configure an SMTP account and the public base URL in the same environment used to start the app. Do not commit SMTP credentials or paste them into chat. For local use, `APP_BASE_URL` must be reachable by the student opening the email link (for example, the computer's LAN address on the same Wi-Fi); for deployment, use the site's HTTPS URL.

```powershell
$env:APP_BASE_URL = "https://your-app.example.com"
$env:SMTP_HOST = "smtp.example.com"
$env:SMTP_PORT = "587"
$env:SMTP_SECURE = "false"
$env:SMTP_USER = "your-smtp-username"
$env:SMTP_PASS = "your-smtp-password"
$env:SMTP_FROM = "THE KITCHEN <no-reply@example.com>"
npm.cmd start
```

For SMTP port 465, set `SMTP_SECURE` to `"true"`. The app does not load `.env` files automatically; set these variables in the terminal before starting the server.

### WhatsApp password-reset links (optional)

WhatsApp password reset uses Meta's WhatsApp Business Cloud API. Create and approve a utility message template with one body text placeholder for the reset URL (for example: “Use this link to reset your password within one hour: {{1}}”). Configure the sender's phone-number ID, access token, API version, approved template name, and template language in the server environment. Keep the access token private and never commit it.

```powershell
$env:APP_BASE_URL = "https://your-app.example.com"
$env:WHATSAPP_PHONE_NUMBER_ID = "your-meta-phone-number-id"
$env:WHATSAPP_ACCESS_TOKEN = "your-private-meta-access-token"
$env:WHATSAPP_API_VERSION = "vXX.X"
$env:WHATSAPP_RESET_TEMPLATE = "your_approved_reset_template"
$env:WHATSAPP_RESET_TEMPLATE_LANGUAGE = "en"
npm.cmd start
```

Use the current API version supported by your Meta app instead of `vXX.X`. For local testing, `APP_BASE_URL` must be reachable from the phone opening the WhatsApp message; `localhost` is only reachable from the same computer, so use a secure, reachable development URL when testing on a phone.

Before a student can choose WhatsApp recovery, an administrator must open **Admin Panel → Account directory → Clients**, enter the student's phone number in international E.164 format (for example, `+263771234567`), confirm the student agreed to use it for recovery, and save it. This is an administrator-confirmed recovery number; the app does not independently verify phone ownership. Keep email recovery available as a fallback.

## Diet monitoring model demo

After starting the app and signing in with a student account, open **Diet Monitoring** from the student home page. The page lets the student choose a general suggestion focus, log menu meals and serving sizes, review estimated nutrition totals and recent logged meals, and rate menu recommendations as helpful or not helpful.

The demo combines a nutrition-fit cold-start ranker with a small per-student logistic preference model. It trains from the student's recommendation feedback and activates the personalized ranking after receiving both positive and negative feedback. Meal records, focus settings, and feedback are stored in the application's database and isolated by student account. New database tables are created automatically on startup.

Nutrition values in `diet-model.js` are illustrative estimates per serving, not verified nutrient-label data. Unlisted foods use a category estimate. Expand and validate that catalog against a trustworthy nutrition source before using it for real dietary decisions. The feature is an educational prototype, not medical advice; its general preference options are not treatment plans or individualized calorie prescriptions.

## Client feedback chatbot

Signed-in students can open **Give feedback** on the home page, choose a topic, and send a message of up to 2,000 characters. They may also take or attach an optional JPEG, PNG, or WebP photo (up to 15 MB before browser-side resizing; stored photos are limited to 5 MB). Feedback and photos are stored in the configured database, shown in recent submissions, and are not sent to an external AI service. Administrators can review submissions and attached photos in **Admin Panel → Client Feedback**, then mark feedback new, reviewing, or resolved. Feedback tables are created automatically at startup.

## Example Flow

1. Customer logs in and browses the menu.
2. Customer adds items and places an order.
3. Restaurant receives the order and updates its status.
4. The student sees status messages in **Your Orders**; the page checks for updates every five seconds.
5. Once the student collects a pickup order, staff selects **Mark Collected**. The student sees a collection message and the order remains marked **Collected**, not **Pending**.
6. Admin can view system summaries.

## Notes

This project is intentionally simple and lightweight, making it affordable and easy to deploy in a local environment. It is suitable as a final-year project prototype and can be expanded with payment integration, notifications, and more advanced system controls.
