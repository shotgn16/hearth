# Price watch

[← Documentation](../README.md#documentation)

Tell Hearth what you want to buy; it keeps checking the price and tells you when it's a good time to buy and where.

**More → Price watch**

## Adding something

1. Type what you want and press **Find prices**. Hearth opens comparison links (PriceRunner, Google Shopping, Amazon UK, Argos, Currys, CamelCamelCamel).
2. Find the product page you like — a **PriceRunner product page** is best because it shows the lowest price across UK retailers — and paste its link.
3. Optionally set **Tell me when it's under £…**, then **Watch it**.

You can also jot `want a new TV under 400`, or accept a price-watch suggestion from Ask Hearth, then add the link later.

## What happens

- Hearth reads the price from the product page (shops publish it as structured data) every 6 hours — change that in **Settings → Integrations**.
- For PriceRunner pages it records the lowest offer and which retailer has it.
- Each check is kept as price history (a small chart next to each item).
- You're notified when the price is at or under your target, or at its lowest since you started watching (at most once every three days per item).
- **Check** shows the current offers plus timing advice — whether this is the lowest seen, above or below the usual price, and seasonal windows such as Black Friday (late November), Boxing Day and January sales, and Prime Day (July).

Ask Hearth combines this with your budgets: *"Should I buy the TV now?"* checks what's free until payday, the relevant budget, the impact on your savings goals and the price history.

## Turning it off

**Settings → Integrations → Price comparison** has separate switches for PriceRunner and for other shop pages.

## Privacy

Only the product link (or search words, when you open comparison links yourself) leaves your server. No financial information is ever sent to shops.

Some shops block automated price checks; if a check fails, the reason is shown on the item and you can try a different shop's link.

Next: [Run it with Docker](standalone-docker.md)
