# LED Volume Team

Public phase-one workspace for Si, Mitch and Ken. Buildless HTML, CSS and JavaScript. Deploy the `dist` directory as a static site. No package installation or external runtime dependencies.

## Implemented
- 22 editable tasks across 11 projects, extracted from the supplied meeting transcript and two whiteboards.
- Kanban grouped by status, owner or priority; drag between columns and reorder.
- Gantt-style timeline with date dragging, end-date resizing, range navigation and proposed/confirmed dates.
- Team overview, filters, search, checklists, dependencies, review flags, undo and validated JSON backup export/import.
- Browser-local persistence. No server-side shared records or team authentication yet.
- Source images in Meeting notes. Most initial dates and statuses are explicitly proposed.

## Vercel deployment
Import a dedicated repository or set the project Root Directory to this application folder. Framework: Other. No build command. Output directory: `dist`. The current deployment is public as requested. Each browser keeps separate edits; authentication and shared data are phase two.

## Phase two
Use an authenticated shared database, invite-only memberships for the three people, row-level access controls, optimistic concurrency, activity history and realtime subscriptions. Preserve stable task IDs; migrate browser backups through validated imports. Do not remove the local-only notice until shared persistence exists. Avoid putting credentials in browser bundles.

## Verification
JavaScript syntax and logic checks with a simulated DOM. Browser visual QA unavailable in this environment. Deployment confirmed separately through the Sites service.

## Owner colours
Si: purple. Mitch: yellow. Ken: blue. Full-card tints, left borders, avatars and timeline bars use a consistent palette.

## Pop studio design
Bright purple, yellow and blue cards, playful outlined UI, illustrated alien/sun/robot avatar images and responsive layout. Si is purple, Mitch yellow and Ken blue. All assets are local; existing browser data keeps the same storage key.
