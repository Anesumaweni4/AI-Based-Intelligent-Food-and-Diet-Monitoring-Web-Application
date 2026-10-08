# Food Ordering System Documentation

## 1. Project Overview
This project is a food ordering application with student credit balances and three account types:
- Students, who order food using deposited credit
- Cashiers, who record deposits and manage order status
- Admins, who manage the system and create cashier accounts

The system allows users to register, login, place food orders, and manage the order flow. The admin can view system users and summary data.

## 2. Roles and Access
### User Access
- Users create an account from the registration page
- They login through the normal user login screen
- After login, they are redirected to the main customer menu page
- Cash held by the cashier can be added to their account as USD credit
- At checkout, students choose cash or student credit (“change”); cash orders do not need a deposit or change the account balance
- Credit orders are checked against and deducted from the student's balance when placed; cashiers/admins can cancel a credit order to refund its balance

### Admin Access
- The admin login is separate from the user login
- The server protects the admin page and admin API routes with a signed, expiring session
- Administrator role and current password hash are verified on every protected request
- Selecting an Admin Login link opens a server-verified access prompt; its credentials are configured with `ADMIN_GATE_USERNAME` and `ADMIN_GATE_PASSWORD` on the server, never in browser code
- The additional prompt expires after five minutes and limits repeated failed attempts; the normal administrator account password is still required afterward
- Admins create cashier accounts from the admin dashboard. Cashier passwords must be at least 14 characters.

### Cashier Access
- Cashiers sign in at `cashier-login.html` and use the Cashier Desk to find a student by name or username and record deposits.
- Deposits, purchases, and refunds are recorded in the `account_transactions` table.
- Cashiers can update order status and cancel an order for a refund. Delivered or already-cancelled orders cannot be refunded again.
- Student balance changes and the corresponding order/transaction records are committed together.

Initial administrator access:
- Username: admin
- A random one-time password is generated and printed to the server terminal on first setup. The insecure legacy `admin123` credential is replaced automatically.
- The administrator can change the password from the admin dashboard. New admin passwords must be at least 14 characters.
- Passwords are stored using scrypt. Admin sessions use HttpOnly, SameSite cookies and expire after eight hours.
- Use HTTPS when deploying outside a trusted local development environment.

## 3. Registration Fields
The registration form includes these user details:
- Full name
- Username
- Age
- Weight
- Height
- Password

These values are stored in the MySQL database in the `users` table.

## 4. User and Admin Storage
The project stores both the normal users and the admin inside the same `users` table.

Key fields include:
- id
- full_name
- username
- password
- role
- age
- weight
- height
- wallet_balance_cents
- created_at

Role values:
- `staff` for student accounts
- `cashier` for cashier accounts
- `admin` for admin user

## 5. Database Setup
The project was originally built with a SQLite fallback, but the app is now configured to use MySQL.

Current database name:
- food_ordering_db

MySQL user created for the app:
- Username: foodapp
- Password: foodapp123

## 6. MySQL Configuration Used
The app is started with these environment variables:

```powershell
$env:DB_HOST = "localhost"
$env:DB_USER = "foodapp"
$env:DB_PASSWORD = "foodapp123"
$env:DB_NAME = "food_ordering_db"
node server.js
```

## 7. Important Database Tables
The database includes these main tables:
- `users` — stores student, cashier, and admin accounts and each student's credit balance in cents
- `menu_items` — stores food items available for ordering
- `orders` — stores customer orders, the student account, and whether the order is paid by cash or student credit
- `order_items` — stores items tied to each order
- `account_transactions` — append-only records of deposits, purchases, and refunds

## 8. Login and Redirect Flow
### Registration flow
- User fills the registration form
- The app validates the inputs
- The record is saved to MySQL
- The user is cleared from the local browser session
- The app redirects to the login page

### Login flow
- User enters username and password
- The backend checks the record in the database
- If the user is admin, they go to the admin page
- If the user is a cashier, they go to the Cashier Desk
- If the user is a student, they go to the home/menu page and can see their balance and recent credit activity

## 9. Runtime Behavior
The app runs locally using:
- http://localhost:3000/login.html

In VS Code, select **Start app and open Login** in Run and Debug and press **F5**. This starts the server and opens the login page when the server is ready. To access the admin login, use the **Admin Login** link on that page so the required access check runs first. A `localhost` URL only works while the server is running.

The admin page can be accessed from the dedicated admin login page.
Cashier login is available at `http://localhost:3000/cashier-login.html`.

## 10. Verified Functionality
The following actions were completed and tested:
- user registration with age, weight, and height
- separate user and admin login flow
- admin access restriction for non-admin users
- redirect after account creation back to login
- saving the data in MySQL
- viewing saved user records in the database
- staff-managed student credit deposits, purchase deductions, and cancellation refunds using SQLite

## 11. Notes
- The app currently uses MySQL for persistent storage.
- SQLite is kept as a fallback only if MySQL is unavailable.
- Database access can be viewed in MySQL Workbench using the `users` table.

## 12. Useful Query
To view the saved user records:

```sql
USE food_ordering_db;
SELECT * FROM users;
```

To view only user details:

```sql
SELECT id, full_name, username, role, age, weight, height, created_at
FROM users;
```

To view student credit balances and the credit ledger:

```sql
SELECT id, full_name, username, wallet_balance_cents / 100.0 AS balance_usd
FROM users
WHERE role = 'staff';

SELECT t.id, u.username, t.type, t.amount_cents / 100.0 AS amount_usd,
       t.order_id, t.created_at
FROM account_transactions t
JOIN users u ON u.id = t.user_id
ORDER BY t.id DESC;
```
