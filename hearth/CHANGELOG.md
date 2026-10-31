# Changelog

## 1.3.1
- Bank feeds (SimpleFIN, including Synci for UK banks): history is fetched in 90-day steps as SimpleFIN requires, reaching back up to about 2 years on the first import and stopping when history runs out
- Clearer messages for a used or expired setup token, and the connection is kept if the first import fails so "Sync now" can retry without a new token
- Supports SimpleFIN protocol v2 (bank names and error messages)

## 1.3.0
- Outlook.com, Hotmail and Microsoft 365 mailboxes: sign in with Microsoft through your own Entra app registration (device-code sign-in that works inside the HA panel); receipts are read through Microsoft Graph with read-only access
- On-premises Exchange mailboxes through Exchange Web Services (NTLM or Basic)
- Outlook / Microsoft 365 calendars copied locally through the same Microsoft sign-in
- Mailbox folders show their names, and the mailbox list shows the account type and sign-in state

## 1.2.0
- Home Assistant now downloads a ready-made image instead of building Hearth on your machine
- Email receipts: connect mailboxes over IMAP; Hearth finds receipts, invoices and bills (including PDF attachments), reads totals, references and items, and matches each to a bill, bank payment, account and month. Everything waits in an approval queue — approve, change the match, or dismiss; approvals are remembered per sender and can be undone
- Regular payments tracker: set payment dates; This month checklist ticked off automatically when payments come out, or marked paid/skipped by hand; late-payment alerts; Ongoing / Cancelling / Paused / Ended (with last payment) / Not recurring; by-category view; 12-month history grid; add your own regular payments; alerts when something charges after you ended it
- Unexpected costs: flag them, see a typical month and what to put aside, suggestions for likely ones, budgets that count only (or leave out) unexpected costs
- Work expenses: To claim → Claimed → Paid back with claim references, repayment matching, CSV export for claims, reminders
- Quick notes recognise work expenses and unexpected costs; new workflow actions; the assistant can look up the tracker, unexpected costs and work expenses
- Fixed duplicate actions when a screen re-rendered

## 1.1.0
- Removed browser device recognition and browser push notifications; notifications now go to Home Assistant notify services (your phones via the HA app), ntfy and Hearth's in-app inbox
- Home Assistant add-on: sidebar panel via ingress with automatic sign-in as your HA user
- Notifications through HA notify services, HA calendar entities as a calendar source, `sensor.hearth_*` entities, workflow actions to fire HA events and call HA services
- Local AI assistant rebuilt: looks up your data with tool calling, streams answers, keeps conversations, proposes actions you confirm
- Per-task models (chat, fast, vision), context window, keep-alive and house rules settings
- Receipt scanning, smart search ("coffee over £5 in September"), describe-a-workflow, AI monthly reviews, budget suggestions, subscription review, event cost estimates
- AI categorisations are reviewable, acceptable in one tap, or undoable; AI activity log

## 1.0.0
- First release
