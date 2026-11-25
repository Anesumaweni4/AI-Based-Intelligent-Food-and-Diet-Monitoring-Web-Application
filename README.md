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
- Admins and cashiers track ingredients separately from prepared menu items in a daily Date / Item / Opening / Used / Added / Closing ledger; potatoes are counted in packets, staples and sausages in kilograms, cooking oil in litres, and burgers, patties, Russians, and hotdogs in pieces
- Every drink on the menu, including water and smoothies, is available in stock control and measured in bottles; both water price options share one bottled-water balance
- Ingredient receipts and usage are recorded manually, and customer orders do not change ingredient stock; admin and cashier inventory refreshes every 12 seconds
- AI diet monitoring for students: collected orders are added to the food diary automatically, students log other food and activity, and every day gets a 0-100 diet score against personal targets (Mifflin-St Jeor energy needs, WHO sugar, fat and fibre guidance)
- Machine learning: K-means finds each student's eating pattern, a Random Forest warns early when a student's diet is likely to be poor next week, and recommendations combine nutrition gaps, a per-student preference model and what similar students buy (see `ml/README.md`)
- Admins see anonymous diet insights: eating-pattern counts, risk levels, the most common concerns and the average daily score
- The hourly activity check-in saves the student's minutes of activity; students can also connect Fitbit to view daily steps and resting heart rate
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

### Deploy with Render and Neon

The repository includes `render.yaml` for deploying the web app to Render. The
app uses Neon for its persistent database; Render's local filesystem is not a
persistent database location.

1. Push the project, including `render.yaml`, to a GitHub repository.
2. Create a Neon project and copy its pooled connection string. Keep the
   connection string private.
3. In Render, choose **New → Blueprint**, connect the repository, and deploy
   the Blueprint. When prompted, provide the Neon connection string for
   `DATABASE_URL`.
4. Render generates `SESSION_SECRET` and `FITBIT_TOKEN_ENCRYPTION_KEY`. The
   latter is persistent and should not be changed after students connect
   Fitbit accounts.
5. After deployment succeeds, open the Render service URL and sign in using
   the administrator account for the configured Neon database.

The application creates its tables and seeds its initial menu and admin account
on startup when needed. Existing local SQLite or MySQL data is not deployed
automatically. To preserve it, migrate the local SQLite database to an empty
Neon database using the migration instructions below before relying on the
deployed database. Do not put database URLs or other secrets in `render.yaml`
or commit them to the repository.

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

The preview matches ingredient inventory items by name and unit, and refuses
to proceed if names are missing or ambiguous. If the preview is correct, apply
it with:

```powershell
npm.cmd run sync:stock:neon -- --apply
```

This updates only `inventory_items.current_quantity`; it does not change menu
items, orders, accounts, or stock-movement history. By default, the source is
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

The login page's **Forgot password?** link lets students request a one-hour, single-use reset link **by email**. Reset tokens are stored as hashes, and resetting a password signs out that student's existing sessions. The page shows the same message whether or not an email is registered, so accounts cannot be discovered through it.

New student registrations must provide an email address; the server rejects a missing or invalid address and does not allow the same address on two accounts. To set a recovery address for an existing student, open **Admin Panel → Accounts**, choose **Clients**, enter the student's email in the **Recovery email** column, and save it. The administrator must confirm the address with the student.

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

For SMTP port 465, set `SMTP_SECURE` to `"true"`. The app does not load `.env` files automatically; set these variables in the terminal before starting the server. Until they are all set, the reset page replies "Password reset email is not configured."

### Setting up reset emails on Render

`render.yaml` lists the email settings, so a Blueprint deploy asks for them. For an existing service, add them under **Render dashboard → your service → Environment**, then redeploy:

| Variable | Example (Gmail) |
| --- | --- |
| `APP_BASE_URL` | `https://your-app.onrender.com` (your service URL, HTTPS) |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | the Gmail address that sends the emails |
| `SMTP_PASS` | a Google **App password** for that account (not the normal password) |
| `SMTP_FROM` | `THE KITCHEN <the same Gmail address>` |

A Gmail App password requires 2-Step Verification on the Google account (Google Account → Security → App passwords). Any other SMTP provider works the same way with its own host, port and login.

**Render's free plan blocks outgoing SMTP ports (25, 465, 587).** On the free plan, send through Gmail with a Google Apps Script relay instead, which the app calls over HTTPS. When `MAIL_WEBHOOK_URL` and `MAIL_WEBHOOK_SECRET` are set they are used instead of the SMTP settings; `APP_BASE_URL` is still required.

1. Signed in to the Gmail account that should send the emails, open <https://script.google.com> → **New project**.
2. Replace the code with the script below and put your own long random secret in `SECRET`.
3. **Deploy → New deployment →** type **Web app**, *Execute as* **Me**, *Who has access* **Anyone** → **Deploy**, then allow the permissions Google asks for.
4. Copy the **Web app URL** (it ends in `/exec`).
5. On Render set `MAIL_WEBHOOK_URL` to that URL, `MAIL_WEBHOOK_SECRET` to the same secret, and `APP_BASE_URL` to the site's HTTPS address, then redeploy.

```javascript
const SECRET = 'put-a-long-random-secret-here';

function doPost(e) {
  const reply = (data) => ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'bad request' });
  }
  if (data.secret !== SECRET) return reply({ ok: false, error: 'forbidden' });
  if (!data.to || !data.subject || !data.text) return reply({ ok: false, error: 'missing fields' });
  MailApp.sendEmail({ to: data.to, subject: data.subject, body: data.text, name: data.fromName || 'THE KITCHEN' });
  return reply({ ok: true });
}
```

A personal Gmail account can send about 100 emails a day this way. If you edit the script later, publish it again with **Deploy → Manage deployments → Edit → Version: New version** so the same URL keeps working.

## AI diet monitoring

Sign in as a student and open **Diet** in the top menu. Registration asks for age, weight, height and sex so the app can work out personal targets; existing students are asked to complete their profile on the Diet page.

| Part | What it does | Where |
| --- | --- | --- |
| Nutrition | Each menu item is split into its parts (rice + chicken stew) and summed from food composition values; 18 common outside foods are included | `nutrition.js` |
| Diary | Orders marked **Collected** or **Delivered** go into the diary automatically; students add other food (breakfast, lunch, supper, snack, late night; today or yesterday) and activity | `diet-service.js` |
| Daily score | 0-100 from energy vs target, protein, fibre, sugar, fat, regular meals with breakfast, and active minutes | `diet-model.js` |
| Model A | K-means eating patterns from the last 7 logged days | `ml/train.py` |
| Model B | Random Forest predicts an average score below 55 over the next 7 days (compared with Logistic Regression, a Decision Tree and a rule baseline) | `ml/train.py` |
| Model C | Recommendations: nutrition-gap fit + personal logistic preference model + popularity among students with the same pattern | `diet-model.js` |
| Admin view | Anonymous totals under **Admin Panel → Diet insights** | `public/admin-diet.js` |
| iPhone step sync | Each student creates a personal key on the Diet page; an Apple Shortcuts automation posts daily steps and Move calories to `POST /api/diet/health-sync` (JSON `key`, `steps`, `kcal`, optional `date`). Steps above 3,000 count as active minutes (100 steps a minute); logged activity and steps are not double-counted | `diet-service.js`, `server.js` |
| Healthy-eating coach | Body goals (stay healthy, lose gently, gain, build muscle) with safe limits, BMI and healthy weight range, water tracker, a full-day meal plan with projected score and cost, healthy swaps for foods eaten this week, "right now" tips and a weekly report card | `diet-coach.js` |

Models are trained offline in Python and saved to `ml/models/diet_models.json`, which the Node server loads, so Render needs no Python. To retrain (Windows):

```powershell
python -m venv ml\.venv
ml\.venv\Scripts\python -m pip install -r ml\requirements.txt
npm.cmd run ml:train   # export foods, simulate diaries, train, write ml/reports/
npm.cmd run ml:test    # check Node gives the same answers as Python
```

The training data is simulated because the app does not yet have months of real diaries; `ml/README.md` explains the simulator, the features, the evaluation and the limitations. Meal times use the `APP_TIMEZONE` environment variable (default `Africa/Harare`). The feature gives general guidance and is not medical advice.

## Free phone reminders (meals, water and exercise)

Students can get free notifications on their phone from the **Diet** page (Today tab → *Meal, water & exercise reminders*). It uses the Web Push standard, so there is no SMS cost, no paid service and no app store.

- **Android:** open the site in Chrome, Edge, Firefox or Samsung Internet, tap **Turn on reminders** and allow notifications.
- **iPhone (iOS 16.4+):** in Safari tap **Share → Add to Home Screen**, open *The Kitchen* from the Home Screen, log in, then tap **Turn on reminders**. Apple only allows web notifications for sites on the Home Screen.

Students choose their breakfast, lunch, supper and exercise times. Water reminders go at 10:30 and 15:30. Reminders are personal and only sent when they help:

| Reminder | Sent when | Skipped when |
| --- | --- | --- |
| Breakfast / lunch / supper | at the chosen time | that meal is already in the food diary (collected orders count) |
| Exercise | at the chosen time | today's active minutes (logged activity or iPhone steps) already reach the target |
| Water | 10:30 and 15:30 | the student is on track with water (30% / 65% of the daily target) |

The message uses the student's own numbers, for example *"Tendai, you still need about 52 g protein and 25 g fibre today…"*.

How it works: `public/sw.js` (service worker) shows the notification; `reminders.js` stores phone subscriptions (`push_subscriptions`), times (`reminder_settings`) and a once-a-day log (`reminder_log`), and checks every minute in `APP_TIMEZONE`. Push keys (VAPID) come from `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, or are created once and kept in `app_settings`. Expired phones are removed automatically.

**Render free plan:** the server sleeps after 15 minutes without visitors, and a sleeping server cannot send reminders. Create a free job on [cron-job.org](https://cron-job.org) that opens `https://<your-site>/api/reminders/tick` every 5 minutes. This keeps the server awake and sends anything that is due (each reminder still goes out only once, and a missed one is caught up within an hour). If `REMINDER_CRON_SECRET` is set, add `?key=<secret>` to that address.

## AI meal photo scanner

On the **Diet** page (Today tab) students tap **Take a photo** of any meal: from THE KITCHEN, home or the market. The photo is shrunk in the browser and sent to Claude (`claude-opus-5-5`, vision) with the student's progress for today. The AI returns, as structured JSON:

- every food on the plate with its portion, grams, calories, protein, carbohydrates, fat, fibre, sugar and how sure it is (Sure / Likely / Unsure);
- whether the plate is balanced (or needs vegetables or protein, or is high in fat or sugar);
- one personal tip based on what the student still needs today.

The student unticks anything wrong, chooses how much they ate and the meal, and taps **Add to my diary**. The nutrition is taken from the stored scan on the server (not from the browser) and logged with the source `ai-photo`, so it feeds the same scores, ML models and coach as every other meal. The photo itself is not stored.

Setup: add `ANTHROPIC_API_KEY` on Render. Without it the card shows that the scanner is being set up and the rest of the site works normally. Each student can scan 15 photos a day (`AI_SCANS_PER_DAY`); failed scans are not counted. Code: `ai-scanner.js` (server), `public/ai-scanner-client.js` (card). Requests use refusal fallbacks (`fallbacks: "default"`) so a declined request is retried automatically on another model.

## Delivery with a rider app and live tracking

Students choose **Pickup** (free) or **Delivery** (fixed fee, `DELIVERY_FEE`, default $3.50) in the cart, type the name of their residence and share their live location (required, so the rider can find them). Each delivery order gets a random **4-digit delivery code**.

| Step | Who | What happens |
| --- | --- | --- |
| Order placed | Student | Fee added to the total; order appears for riders as a new job |
| Accept | Rider | Rider app (`/rider.html`) shows new jobs with a chime; first rider to accept gets it |
| Preparing / Ready for rider | Kitchen | Orders board; delivery orders cannot be marked "collected" |
| Picked up | Rider | Status becomes *Out for Delivery*; rider goes online and shares GPS every few seconds |
| On the way | Student | **Track** opens a live map (OpenStreetMap) with the rider, the student and the kitchen, plus an ETA |
| Delivered | Rider | Rider enters the student's code; a wrong code is refused. Meal goes into the diet diary |

The student gets a phone notification (Web Push) at every step. Riders see the address, the items, cash to collect, and one-tap Call / WhatsApp / Directions. Admins create rider accounts under **Team & security** (account type *Delivery rider*), or set `RIDER_USERNAME`, `RIDER_PASSWORD` (14+ characters) and `RIDER_NAME` on Render to create the first rider automatically. The admin panel has a **Deliveries** section with live totals, every rider (online or offline, jobs and fees today) and every delivery order, where the admin can give an order to a rider, move it to another rider, or open it for any rider; cashiers and admins can also open the rider app when no rider is on shift. Optional: set `KITCHEN_LAT` and `KITCHEN_LNG` to show the kitchen on the map. Code: `delivery.js`, `public/rider.html`, `public/rider.js`, `public/track.js`.

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
