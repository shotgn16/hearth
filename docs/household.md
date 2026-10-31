# Households: people, shared and individual budgets

[← Documentation](../README.md#documentation)

One Hearth install holds one household. Inside it there are **users** and **people**.

## Users — people who sign in

**Settings → People & household → Add user** (admins only).

- Each user has their own email and password, and sees the whole household.
- **Linking to Home Assistant:** the first time a user opens Hearth from the HA sidebar, they sign in once with their Hearth password. Their HA login is then linked and future visits sign in automatically. To skip that step, switch on **Let any Home Assistant user in** in the add-on options — any HA user who opens the panel then gets a Hearth login of their own.
- **Admin** users can add and remove users. Everyone can edit their own name, colour and password.
- Every transaction records which user it belongs to — from the account owner for bank transactions, or whoever jotted or imported it.

## People — who money is spent on

Children, parents, pets: anyone you want to track spending for without giving them a login. Each user is also a person automatically.

Assign spending to a person from a transaction, in bulk from the grid, automatically with a [workflow](workflows.md), or by naming them in a jotted note ("£25 school trip for Ella").

## Accounts

Accounts from your bank connection or imports can be **joint** or belong to one user. Individual budgets count spending made by a user *or* from an account they own.

## Budgets: together, individual, or for someone

When you create a budget, **Who it's for** decides what it counts:

| Choice | Counts | Example |
|---|---|---|
| **Everyone together** | All household spending in the chosen categories | Groceries £650/month |
| **One user's own spending** | Only that user's spending | Alex fun money £150/month |
| **Spending for a person** | Spending assigned to that person | Ella's clubs and clothes £80/month |

Budget alerts for an individual budget go to that user's inbox. Both kinds can exist side by side — a shared groceries budget and separate personal budgets.

## Savings and targets

Targets can also be **together** or **just one of us**, with an optional date and linked savings account. The year planner can be viewed for the household or for each user.

## Reporting by person or user

- **Money → More filters** by person or by "spent by user".
- **Insights → Reports** — set rows to *Person* or *Spent by*, or filter the whole report to one user.
- **Ask Hearth** — "How much did Sam spend on fuel this year?" or "What have we spent on Ella since September?"

Next: [Local AI](local-ai.md)
