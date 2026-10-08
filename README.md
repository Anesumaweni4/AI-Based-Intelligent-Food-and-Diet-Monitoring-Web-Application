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
- Mark pickup orders as collected so they no longer remain pending
- Restaurant dashboard to manage incoming orders
- Delivery dashboard to mark orders as ready/out for delivery/delivered
- Staff login and admin dashboard

## Tech Stack

- Node.js
- Express.js
- MySQL database
- HTML, CSS, and JavaScript

## Database Setup

The app uses MySQL when it can connect. If MySQL is unavailable, it uses the
SQLite database at `data/food-ordering-app.db` by default. The downloaded
`food-ordering-app.db` database is imported there so the app can use it locally.
The original download and any older database files are left untouched.

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
- Clicking an Admin Login link opens a server-verified access prompt. Configure `ADMIN_GATE_USERNAME` and `ADMIN_GATE_PASSWORD` on the server; these values are not included in client-side code. The prompt is an additional gate, not a replacement for the admin account password.

PowerShell examples (set the values before `npm.cmd start`):

```powershell
$env:ADMIN_PASSWORD = "replace-with-a-unique-password-of-at-least-16-characters"
$env:ADMIN_GATE_USERNAME = "your-admin-gate-username"
$env:ADMIN_GATE_PASSWORD = "your-unique-admin-gate-password"
$env:SESSION_SECRET = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm.cmd start
```

`ADMIN_PASSWORD` is only used to create an admin account or replace the insecure legacy default; it does not overwrite a password that has already been changed.
The additional admin access prompt is rate-limited and uses a short-lived HttpOnly cookie; the administrator account password is still required. Use HTTPS when deploying beyond a trusted local development network.

## Example Flow

1. Customer logs in and browses the menu.
2. Customer adds items and places an order.
3. Restaurant receives the order and updates its status.
4. The student sees status messages in **Your Orders**; the page checks for updates every five seconds.
5. Once the student collects a pickup order, staff selects **Mark Collected**. The student sees a collection message and the order remains marked **Collected**, not **Pending**.
6. Admin can view system summaries.

## Notes

This project is intentionally simple and lightweight, making it affordable and easy to deploy in a local environment. It is suitable as a final-year project prototype and can be expanded with payment integration, notifications, and more advanced system controls.
