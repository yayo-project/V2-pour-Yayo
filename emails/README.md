# Yayo — Supabase email templates (FR + EN + AR in one email)

Supabase has ONE template per email type and doesn't know the user's language,
so each template stacks all three languages: French first, then English, then
Arabic (right-to-left block). Every user understands their email.

## How to install (5 minutes)
1. Open **Supabase → Authentication → Emails (Email Templates)**.
2. For each type below, open the matching file, copy ALL the HTML, paste it
   into the template body, and set the subject line:

| Supabase template | File | Subject to paste |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `Confirmez votre compte Yayo · Confirm your Yayo account` |
| Reset password | `reset-password.html` | `Réinitialisez votre mot de passe Yayo · Reset your Yayo password` |
| Magic link | `magic-link.html` | `Votre lien de connexion Yayo · Your Yayo sign-in link` |

3. Sender name (SMTP settings): **Yayo** — sender email: **contact@yayo.digital**.
4. Send yourself a test (forgot password) and check it looks right.

`{{ .ConfirmationURL }}` is filled automatically by Supabase — don't edit it.
