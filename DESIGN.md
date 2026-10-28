# Design

## Source of truth
Status: Active. Date: 2026-10-28. Surface: Korean internal seat-preference and allocation web app. Evidence: the two supplied office images; no existing implementation, design system, or assets were present. Image 1 provides 21 seats on floor 13 and three furniture types. Image 2 provides 20 eligible people after excluding green cells.

## Brand
Calm, practical, welcoming. Product name: 자리. Trust comes from visible submission status, editable source data, a reproducible draw seed, and an explanation of the allocation criteria. Avoid decorative gradients, loud colors, and invented allocation guarantees.

## Product goals
Collect each person's unique ordered preferences for all 21 seats; bring members of the same part closer; show a stable, reproducible allocation and leave one vacancy for the initial 20-person roster. Persist submitted preferences, support file collection and CSV results. No authentication or production deployment is included.

## Personas and jobs
Participants explore furniture types, select themselves, order preferences, and submit. An organizer corrects the roster, tracks completion, collects preference files, and runs the allocation after every participant has submitted.

## Information architecture
One workspace with three navigation states: 좌석 둘러보기, 선호 입력, 배정 결과. A persistent floor map and a participant preference panel form the main surface. Roster management, Google Sheets table input, and allocation settings use dialogs. Seat-type cards explain A/B/C. A submission overview appears below the map.

## Design principles
Seat geometry and part colors have separate meanings. A/B/C describe furniture, whereas yellow/blue/red identify 배차/데이터/맵. Display real completion counts; example preferences belong to a separate demo mode. Keep incomplete preferences as drafts and require all 21 unique choices before submission. Explain distance search limits in the allocation guide.

## Visual language
Warm gray canvas (#f7f8fa), white surfaces, deep ink (#202833), restrained teal (#087f72). Part colors: yellow (#e9b740), blue (#5388dc), red (#db7776), always paired with a written label. Korean system fonts with generous line height, 8px spacing rhythm, 12–16px corner radii, subtle borders and restrained shadows. Small line icons and original reference photos. Short state transitions; honor reduced motion.

## Components
Sidebar, workspace header, three-step navigation, floor-plan seat buttons, contextual preference panel, sortable ranking rows, part chips, furniture cards, participant table, dialogs, toasts, loading indicator, results table, sheet-paste textarea, CSV/TSV import preview, and cell-specific validation feedback. CSS custom properties in styles.css own tokens. Seat buttons show number, rank or occupant, keyboard focus, selection, and furniture zone.

## Accessibility
Target WCAG 2.2 AA. Native buttons and labeled inputs, visible keyboard focus, semantic headings and tables, descriptive seat labels, live feedback, and keyboard rank controls. Dialogs manage focus and Escape. Color is supplemental to part names and A/B/C labels. No drag-only action. Mobile targets at least 40px.

## Responsive behavior
At 1200px, narrow the sidebar; at 1000px, stack the map and preference panel; at 700px, use a compact top navigation and single-column furniture cards. Preserve the real vertical A/B/C floor layout. Seat map offers explicit zoom controls and a scroll container on small screens.

## Interaction states
Initial: zero submitted preferences; allocation disabled. Draft: partial unique ranking with next-choice guidance. Submitted: complete, editable ranking. Allocation: work runs outside the UI thread with progress. Success: colored map, preference rank, part-distance metrics, seed, and downloadable results. Errors retain drafts. Server saves are visible; static preview uses browser storage and file export. Sample mode is clearly marked and never writes actual submissions. Sheet imports validate every provided row before applying the batch, with explicit row/column errors and a read-only table preview. Blank templates and submitted preferences can be downloaded as Sheets-compatible CSV.

## Content voice
Concise Korean. Use 지망, 파트, 구역, 선호 저장, 배정. Show concrete numbers and explain why allocation is unavailable. Surface algorithm details only in the guide and results methodology.

## Implementation constraints
Dependency-free HTML/CSS/JavaScript modules and Node built-ins. Use an ESM Web Worker for matching. Minimal Node HTTP server persists workspace data locally, with atomic writes and validated JSON endpoints. Static build can use browser-only persistence. Verify the matching invariants with node:test and real desktop/mobile browser interaction with the available Playwright installation.

## Open questions
- [ ] Organizer: confirm image-transcribed names; the editable roster makes corrections reversible.
- [ ] Organizer: provide measured seat coordinates if physical distances in meters are needed; initial calculations use normalized diagram coordinates and report relative distances.
- [ ] Organizer: confirm whether the twentieth roster member count should become 21; initial allocation leaves one vacancy.
- [ ] Organizer: define authentication and deployment requirements for a future shared production service.
