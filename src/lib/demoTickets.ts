export interface DemoTicket {
  subject: string;
  body: string;
  customer_tier: string;
  prior_contacts_7d: number;
  expect: string;
}

export const DEMO_TICKETS: DemoTicket[] = [
  {
    subject: "Question about last month's invoice",
    body: "Hi, I was reviewing our invoice from September and the seat count looks slightly higher than I expected. Could you walk me through the line items? Nothing urgent, just want to make sure our records match.",
    customer_tier: "pro",
    prior_contacts_7d: 0,
    expect: "Billing, P3",
  },
  {
    subject: "Double charged — this is the last straw",
    body: "You charged me TWICE this month. I've complained about billing errors three times already and this keeps happening. I want both charges refunded NOW or I'm canceling my account immediately. This is completely unacceptable.",
    customer_tier: "pro",
    prior_contacts_7d: 3,
    expect: "Human, P1",
  },
  {
    subject: "Dashboard returning 500 errors during client demo",
    body: "Our main dashboard is throwing 500 errors right now and we have a client demo in 40 minutes. This is blocking our whole team. Please help urgently!",
    customer_tier: "enterprise",
    prior_contacts_7d: 0,
    expect: "Technical, P1",
  },
  {
    subject: "CSV import keeps failing",
    body: "I'm trying to import our event data via CSV but the import keeps failing on some rows. The dates are in MM/DD/YYYY format. Is that the problem, or is there something else I should check?",
    customer_tier: "pro",
    prior_contacts_7d: 0,
    expect: "Technical, P3",
  },
  {
    subject: "Locked out — lost my 2FA device",
    body: "I got a new phone and can no longer generate 2FA codes. I don't have my backup codes with me. I'm completely locked out of my account and need access restored as soon as possible.",
    customer_tier: "pro",
    prior_contacts_7d: 0,
    expect: "Account, P1",
  },
  {
    subject: "Please delete our account",
    body: "We've decided to move to a different vendor. Please permanently delete our account and all associated data under GDPR. Our compliance team requires written confirmation once deletion is complete.",
    customer_tier: "enterprise",
    prior_contacts_7d: 1,
    expect: "Human",
  },
  {
    subject: "It's not working",
    body: "Hey, it's not working. Can someone take a look?",
    customer_tier: "free",
    prior_contacts_7d: 0,
    expect: "Human (uncertain department)",
  },
  {
    subject: "Refund request — $900",
    body: "Due to a budget freeze we won't be using Lumen next quarter. I'd like a refund of $900 for the unused portion of our annual plan. Please process this at your earliest convenience.",
    customer_tier: "enterprise",
    prior_contacts_7d: 0,
    expect: "Human (refund over $500)",
  },
];
