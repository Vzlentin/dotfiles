---
name: email
description: Write an email to business people with concrete examples taken from real data, ready to paste into Gmail. Use when the user asks for an email, or a reply to a thread, that explains a case or asks business questions.
---

# email

Load `outbound-writing` for the voice. Write in the language of the thread.

## Facts first

- Check each example on the real data before you cite it. If the data contradicts the premise of a question, change the question or drop it, and tell the user.
- Choose real cases that the reader knows: their OP numbers, UB labels, brands, EANs, dates.
- Say "peut", "can" or similar when you did not check every condition.

## Shape

- Greeting, then one line that links to the last message of the thread.
- One line that says why you write.
- One section for each topic:
  - an underlined bold heading, for example `<u><b>Plusieurs UB chez le même fournisseur :</b></u>`;
  - one or two sentences with the concrete case;
  - a small table of real rows, 3 rows at most;
  - the questions as bullets, each one answerable alone.
- When the data already answers a question, propose the answer and ask for a confirmation.
- Plain business words. No table names, code, internal project names or tool names.
- Short sign-off.

## Deliver

- Write the mail as HTML with inline styles (tables with `border-collapse` and cell borders) in `/tmp/mail/<slug>.html`, and `open` it. The user copies it from the browser into Gmail.
- In the chat: what the data changed, the text version, and the caveats on the numbers.
- Never send the mail.
