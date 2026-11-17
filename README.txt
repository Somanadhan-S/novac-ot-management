NOVAC OT MANAGEMENT - DASHBOARD UPDATE

Files in this package:
1. index.html
2. firebase-layer.js

INSTALLATION
1. Download and keep a backup of your current index.html and firebase-layer.js from your GitHub repository.
2. Replace those two files with the files in this package. Keep firebase-config.js unchanged.
3. Commit/push the two replacements to the same GitHub Pages repository.
4. Open the website and hard-refresh (Ctrl + F5). Sign in as Admin and verify the dashboard.

DASHBOARD CHANGES
- Separate Month and Year selectors (years 2026-2030).
- Dashboard team chart uses the existing employee/record Dept field (ID, PDN, QC), displayed as Team. No new Team field is added and existing Firestore records are not migrated.
- Admin-only dashboard reports: Project-wise OT Expenses, Team-wise OT Expenses, Total Hours Spent by Employee, and Employee-wise OT Expenses.
- Public Holiday cost is calculated at the weekend rate: INR 2,000 per employee per holiday date.
- Weekend/Public Holiday cost is allocated among that employee's records/projects for the date in proportion to each record's OT hours.
- Weekday cost is INR 250 per OT hour (the existing calculation only counts weekday OT after 9 PM).
- Non-admin users do not see the Admin finance section, employee-hours chart, or Monthly Reports page.

IMPORTANT
- Cost totals are calculated from the records visible to the signed-in Admin; no cost fields are written into employee-readable OT records.
- This update does not change Firestore Security Rules, Firebase configuration, Authentication users, or existing records.
- Keep your current Firestore Rules. They must continue to allow Admin to read all OT records and restrict non-admin users to their own records as already configured.
- This package was syntax-checked with Node.js, but it has not been deployed or live-tested against your Firebase project. Test with one Admin account and one regular employee account before relying on reports.
