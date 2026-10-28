# Design

## Source of truth
Status: Active. Date: 2026-10-28. Surface: Korean internal seat-preference and allocation web app. Evidence: the two supplied office images; no existing implementation, design system, or assets were present. Image 1 provides 21 seats on floor 13 and three furniture types. Image 2 provides 20 eligible people after excluding green cells.

## Brand
Calm, practical, welcoming. Product name: 자리. Trust comes from visible submission status, editable source data, a reproducible draw seed, and an explanation of the allocation criteria. Avoid decorative gradients, loud colors, and invented allocation guarantees.

## Product goals
Collect each person's unique ordered preferences for all 21 seats and an optional preferred companion. Default matching maximizes companion fulfillment first, then minimizes searched same-part distance, then original seat-rank sum. Show a reproducible allocation and leave one vacancy for the initial 20-person roster. Also offer random preference generation followed by distance matching with saved companion requests, and a pure random seat draw without seat, companion, or part priorities. Persist submitted preferences, accept public Google Sheets links and table/file collection, and export CSV results. No authentication or production deployment is included.

## Personas and jobs
Participants explore furniture types, select themselves, order preferences, and submit. An organizer corrects the roster, tracks completion, collects preference files, and runs the allocation after every participant has submitted.

## Information architecture
One workspace with three navigation states: 좌석 둘러보기, 선호 입력, 배정 결과. A persistent floor map and a participant preference panel form the main surface. Roster management, Google Sheets input, random allocation, and matching settings use dialogs. Header actions expose 올 랜덤 and 공개 시트로 배정. Seat-type cards explain A/B/C. A submission overview appears below the map.

## Design principles
Seat geometry and part colors have separate meanings. A/B/C describe furniture, whereas yellow/blue/red identify 배차/데이터/맵. C has physical pairs 85–90, 86–89, and 87–88, shown by connectors and labels. Companion requests are optional and may cross parts; chosen pairs move both people into C, even for one-way requests. Mutual requests count as two directed fulfillments. Display real completion counts; example preferences belong to a separate demo mode. Keep incomplete preferences and companion changes as drafts and require all 21 unique seat choices before submission. Explain priority order and distance search limits in the allocation guide.

## Visual language
Warm gray canvas (#f7f8fa), white surfaces, deep ink (#202833), restrained teal (#087f72). Part colors: yellow (#e9b740), blue (#5388dc), red (#db7776), always paired with a written label. Korean system fonts with generous line height, 8px spacing rhythm, 12–16px corner radii, subtle borders and restrained shadows. Small line icons and original reference photos. Short state transitions; honor reduced motion.

## Components
Sidebar, workspace header, three-step navigation, floor-plan seat buttons and C-pair connectors, contextual preference panel with companion dropdown excluding self, sortable ranking rows, part chips, furniture cards, participant table, dialogs, toasts, loading indicator, results table, sheet-paste textarea, CSV/TSV import preview, and cell-specific validation feedback. CSS custom properties in styles.css own tokens. Seat buttons show number, rank or occupant, keyboard focus, selection, and furniture zone. Results show requested companion, actual C-pair neighbor, fulfillment count, and original submitted seat ranks.

## Accessibility
Target WCAG 2.2 AA. Native buttons and labeled inputs, visible keyboard focus, semantic headings and tables, descriptive seat labels, live feedback, and keyboard rank controls. Dialogs manage focus and Escape. Color is supplemental to part names and A/B/C labels. No drag-only action. Mobile targets at least 40px.

## Responsive behavior
At 1200px, narrow the sidebar; at 1000px, stack the map and preference panel; at 700px, use a compact top navigation and single-column furniture cards. Preserve the real vertical A/B/C floor layout. Seat map offers explicit zoom controls and a scroll container on small screens.

## Interaction states
Initial: zero submitted preferences; preference-based allocation disabled, with random allocation available. Draft: partial unique ranking with next-choice guidance. Submitted: complete, editable ranking. Allocation: work runs outside the UI thread with progress. Matching success: colored map, preference rank, part-distance metrics, seed, and downloadable results. Pure random success: colored map and seed, with preference-rank metrics marked not applicable; part distances describe the outcome and imply no optimization or stability guarantee. Errors retain drafts. Server saves are visible; static preview uses browser storage and file export. Sample mode is clearly marked and never writes actual submissions.

Drafts: seat rankings and companion choices are stored separately in localStorage. A delayed save response must preserve changes made after the save began. Companion or roster changes invalidate old matching results; deleted participants prune requests involving them. Missing companion fields in old saved workspaces default to an empty map.

Random dialog: offer 랜덤 선호 + 파트 거리 배정 and 완전 랜덤 좌석 추첨. The first replaces all saved participant rankings with newly generated 21-seat rankings and preserves companion requests before running distance matching. The second shuffles seats using seeded Fisher–Yates, preserves submitted rankings and companions, ignores them when drawing, and works without complete preference submissions. An empty seed generates a fresh crypto UUID; a supplied seed reproduces the same draw for the same inputs. Explain the saved-preference effect before execution.

Sheet input: accept a public Google Sheets URL, a seed, a matching mode, pasted tables, and CSV/TSV files. Default URL is the supplied 좌석배정선호조사 spreadsheet, filled with the initial 20-person roster and 24 headers: name, part, 21 seat ranks, and 함께 앉고 싶은 동료. Google Sheets 새로 만들기 opens that source document's /copy flow in the user's Google account; it copies current source contents, including responses, so explain clearing C2:X21 for a fresh survey. Current-roster blank CSV remains available if the roster changes.

시트 불러와 배정 fetches the selected tab through the Node server, validates every supplied row against the current roster, merges complete rows with existing submissions and companion choices, and starts matching only when the merged input covers all participants. Invalid rows or remaining missing preferences prevent the automatic import from applying. Manual paste/file imports can still apply partial batches after validation. Show explicit row/column errors and a read-only table preview. Blank templates and submitted preferences can be downloaded as 24-column Sheets-compatible CSV. Legacy 23-column sheets preserve existing companion choices; an explicitly blank companion cell in a 24-column sheet clears that person's choice. Provide complete CSV/TSV examples and a 24-column row example.

## Content voice
Concise Korean. Use 지망, 파트, 구역, 선호 저장, 배정. Show concrete numbers and explain why allocation is unavailable. Surface algorithm details only in the guide and results methodology.

## Implementation constraints
Dependency-free HTML/CSS/JavaScript modules and Node built-ins. Use an ESM Web Worker for matching and random draws. Minimal Node HTTP server persists workspace data locally, with atomic writes and validated JSON endpoints. Public Sheets fetching accepts HTTPS docs.google.com spreadsheet links, converts regular or published links to CSV, and restricts Google download redirects. A 15-second timeout and 1MiB response cap bound downloads. Accept links shared as anyone-with-link viewer or published to the web; report private/login-required documents as input errors. Static build can use browser-only persistence and paste/file imports, but cannot fetch a public sheet URL through the Node API.

Matching: enumerate disjoint requested edges occupying up to three physical C pairs and guarantee maximum directed companion fulfillment. Screen every maximum-companion plan with seeded baseline priorities, then expand the best twelve across 7,980 part-anchor candidates. Each plan fixes a companion-promoted applicant list and designated-seat priorities before ordinary Gale–Shapley. Stability is checked against these composite preferences and priorities; displayed ranks use the original 21-seat submissions. Distance is the minimum among searched candidates, with no global distance guarantee. Without companion requests, retain the existing 7,981 distance candidates or one preference candidate.

Verification: the earlier random/public-sheet change had a source-inspection-only boundary. The current companion/template change requires targeted unit/API regressions, syntax checks, static build, and real-browser checks for draft preservation, imports/exports, worker matching, original ranks, and responsive layout. Verify the real Google Sheet separately by reading its public CSV after the authorized write.

## Open questions
- [ ] Organizer: confirm image-transcribed names; the editable roster makes corrections reversible.
- [ ] Organizer: provide measured seat coordinates if physical distances in meters are needed; initial calculations use normalized diagram coordinates and report relative distances.
- [ ] Organizer: confirm whether the twentieth roster member count should become 21; initial allocation leaves one vacancy.
- [ ] Organizer: define authentication and deployment requirements for a future shared production service.
