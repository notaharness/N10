Opening `https://beam.n10.is/` with no fragment shows beam's homepage. Any fragment still takes the ceremony path, so a link that is incomplete or invalid shows its own alert and none of the homepage.

## Homepage

`worker/public/index.html`

- `#intro` holds the default heading and a short description of beam: it pools your machines into a fleet, protected by your passkey. `#home` holds the scene, where to start (n10 Desktop → Fleet, `beam init`, `beam join`), and the links to the repository and https://n10.is.
- The scene is an inline SVG (`role="img"`) of a laptop, a server and a phone. Each pair is joined by a two-lane beam in the mark's sage, with a packet running each way in olive (light) or sand (dark). A packet is a dash that moves along its lane (`@keyframes beam`). The animation is declared only inside `@media (prefers-reduced-motion: no-preference)`, so under `reduce` the packets stay where they are, halfway along each beam.
- When there is a fragment, the script hides `#home` and shows the passkey compatibility `<details>`, which is hidden on the homepage. A global `[hidden] { display: none; }` keeps the `display: grid` summary list hidden until a request fills it.
- The page stays a single document with one inline script and one inline style. It uses only presentation attributes and classes, so the CSP hashes in `worker/public/_headers` cover everything and nothing loads from anywhere else.

## Tests

- `worker/test/flows.test.mjs`: the no-fragment case checks the homepage heading, scene, links, that there is no alert, button, compatibility section or summary, and that no WebAuthn call is made. A pair of cases runs the page under `reducedMotion: "no-preference"` and `"reduce"` and checks the packets' computed `animation-name` (`beam` or `none`). The invalid-request cases and a valid request check that `#home` is hidden.
- `worker/test/page.test.ts`: "loads nothing" allows exactly the three navigation hrefs: repository and n10 on the homepage, and the repository again in the footer.

## Spec

`docs/02-identity.md` (Ceremonies, step 1) describes the no-fragment homepage.

## Needs Hermann

- An expired request can't be detected from the fragment: an expired slot looks like a fresh one to the worker. So the page shows expiry as it already did, with the five-minute note, and the originating machine reports it. There is no separate "expired" page state.
- The worker is not deployed.

Closes #34
