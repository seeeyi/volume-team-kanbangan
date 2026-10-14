# LED Volume Team

Public phase-one workspace for Si, Mitch and Ken. Buildless HTML, CSS and JavaScript. Deploy the `dist` directory as a static site. No package installation or external runtime dependencies.

## Implemented
- 22 editable tasks across 11 projects, extracted from the supplied meeting transcript and two whiteboards.
- Kanban grouped by status, owner or priority; drag between columns and reorder.
- Gantt-style timeline with date dragging, end-date resizing, range navigation and proposed/confirmed dates.
- Team overview, filters, search, checklists, dependencies, review flags, undo and validated JSON backup export/import.
- Browser-local persistence. No server-side shared records or team authentication yet.
- Meeting notes are editable. Most initial dates and statuses are explicitly proposed. Whiteboard photos are excluded from the published source.

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

## Workspaces, edit history and focus arcade
- Open the workspace name to rename it, create a blank/copy workspace, or switch boards. Tasks, notes, history and focus rewards are separate per workspace.
- `Editing as` is a remembered, self-selected editor name. Each task change, reorder, move, date edit or notes update records an editor and timestamp. The History panel shows the local trail. Attribution is not authenticated until phase two.
- Meeting notes and the MEETING → WORKSPACE label are editable, included in backups and covered by undo. The requested source paragraph and Dates and assumptions section have been removed.
- Light the wall is a 5/15/25-minute focus timer. Pause/resume, LED tile rewards and completed-session counts save locally. Closing the panel does not stop the timer. Focus sessions do not alter task status.

## Live site and automatic deployments
Current public site: https://vp-team-volume.seeemotion.chatgpt.site
GitHub source: https://github.com/seeeyi/volume-team-kanbangan
For Vercel, import this repository, use Framework Preset Other, leave Build Command empty and use Output Directory dist. GitHub pushes to the production branch will deploy automatically after the Vercel project is connected.
The existing ChatGPT Site and a Vercel deployment have separate browser-storage origins; export/import a backup when moving between them.
