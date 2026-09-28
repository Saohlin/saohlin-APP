# Auth and routing

Routing uses expo-router, with access rules in the group layouts rather than in
individual screens.

```
app/
  _layout.tsx                fonts → theme → i18n → session → stack
  index.tsx                  splash + entry
  intro.tsx                  welcome video
  profile-setup.tsx          onboarding part 1 (profile + terms)
  verify-email.tsx           registered, waiting for email confirmation
  auth-callback.tsx          opened from the confirmation email
  reset-password.tsx         opened from the reset email

  (auth)/          RequireGuest
    sign-up.tsx
    sign-in.tsx
    forgot-password.tsx

  (onboarding)/    RequireSessionOnly
    deeper.tsx               onboarding part 2 (four questions)
    welcome.tsx

  (app)/           RequireOnboarded
    (drawer)/                chat · cards · journal · profile · settings · feedback
    guide/[id].tsx
    journal/new.tsx
    paywall.tsx              modal

  legal/[doc].tsx            public
```

## Guards

| Guard | Lets through | Otherwise |
|---|---|---|
| `RequireGuest` | signed-out users | sends signed-in users where they belong |
| `RequireSessionOnly` | signed in, onboarding not finished | guests to sign-in, finished users to chat |
| `RequireOnboarded` | signed in, verified, onboarding complete | to the first unmet step |
| `RequirePaidRoute` | routing only, see below | to the paywall |

Status is derived in one place (`SessionProvider`) and the guards read it. Sign-in
doesn't navigate by itself; the guards route from the new status.

## Notes

- Onboarding order is enforced by status, not navigation history, so a deep link
  can't skip ahead to the deeper questions before consent.
- `RequirePaidRoute` decides what to show, never what to allow. Entitlement is
  checked on the server for every message; never use it to guard data or AI calls.
- `SessionProvider` mirrors server state from Supabase (`get_me`); the backend enforces access.
- Sign-up requires email confirmation. The profile and consent collected before
  registration are sent with the sign-up call and stored server-side by a trigger.
- The session is encrypted with a key kept in the device keychain (`lib/secureStorage.ts`).
- The splash stays up while the session restores, so there's no flash of sign-in.
