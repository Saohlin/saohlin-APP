# Auth and routing

Routing uses expo-router, with access rules in the group layouts rather than in
individual screens.

```
app/
  _layout.tsx                fonts → theme → i18n → session → stack
  index.tsx                  splash + entry
  intro.tsx                  welcome video
  profile-setup.tsx          onboarding part 1 (profile + terms)
  verify-email.tsx           signed in but not verified, so outside the groups

  (auth)/          RequireGuest
    sign-up.tsx
    sign-in.tsx
    forgot-password.tsx
    reset-password.tsx       opened from the reset link

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
- `SessionProvider` mirrors server state. Network calls are stubbed with `TODO`s
  until the backend is connected.
- The session is stored in the device keychain (`expo-secure-store`), never in
  plain AsyncStorage.
- The splash stays up while the session restores, so there's no flash of sign-in.
