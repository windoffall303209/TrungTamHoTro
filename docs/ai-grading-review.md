# AI grading assistance: implementation and UX review

Initial review disposition: ship for private, instructor-reviewed inline-text suggestions. The subsequent TXT extension described below was verified by component tests and a bounded desktop/mobile browser pass, not by a new independent review. Both extend the existing academic grading modal and administrator AI task settings without a new visual identity.

## User flow

1. An instructor with `exam:manage` opens a submission in the existing grading modal. Opening the panel does not fetch or generate a suggestion. Inline text, TXT-only submissions, and inline text plus TXT are supported. Empty submissions and those containing unsupported attachments remain manual-only.
2. The instructor chooses Vietnamese, English, or bilingual suggestion output, then explicitly checks the saved suggestion with `GET /instructor/assignment-submissions/:id/ai-suggestion`.
3. Only a `NOT_REQUESTED` response exposes the create action. The accompanying notice explains that the answer and rubric go to the administrator-configured model and may incur a charge. The explicit `POST` sends the expected submission revision and language; instructors cannot supply the model or override source content.
4. A ready result displays the model, proposed total, rubric criterion scores and reasoning, expandable quoted evidence, and proposed feedback. For TXT submissions, each source snapshot can be expanded and each quote identifies a source containing it. Original filenames, source text, and evidence are not automatically translated. Suggestions remain private to their requesting instructor and do not constitute an official grade. An insufficient-evidence result provides feedback without an action to copy scores.
5. Before copying, the instructor must check the acknowledgement that the current scores and feedback will be replaced. Copying changes only the manual form. The instructor can edit those values and must separately submit **Lưu điểm rubric** to save the grade through the existing grading workflow.

## State and source boundaries

The panel resets across instructor identity, submission identity/revision, and assignment version. Changing output language clears the visible result and acknowledgement. Unmounting aborts the client request and late responses cannot populate a replacement panel. Client checks reject a mismatched revision/version and require rubric coverage, bounded criterion scores, and evidence quoted from the current answer before enabling score transfer.

The backend resolves authorized source context and keys stored requests by instructor identity, submission identity, source-context hash, and output language. It rechecks current source context after generation. A unique claim prevents concurrent generation for the same identity/context; a saved ready result can be read without an active model configuration. Database mode stores claims durably; the implementation also supports memory storage when database startup connections are disabled, so durability is not implied for that mode.

During a request, duplicate actions are disabled. A client timeout or closed modal does not prove that server-side processing stopped. Recovery uses the saved-status GET. `GENERATING` and `UNCERTAIN` show guidance to inspect later or contact an administrator and do not expose automatic paid retries. A successful recovery read may return the saved result; an ambiguous operation is not described as a failed generation that is safe to repeat.

## Existing-system fit

The panel uses the incumbent paper/ink tokens, bordered sections, shared buttons and fields, wrapping text, and rubric rows described by `apps/web/DESIGN.md`. The task configuration belongs to the administrator's existing `GRADING_ASSIST` settings. No global design document or sidecar needs regeneration for this bounded addition.

The academic page contains a fixed modal within the animated workspace. The `workspace-enter` animation now uses `backwards` fill instead of retaining its final transform, allowing the modal to remain viewport-relative after the entrance animation completes. The existing reduced-motion rule disables this animation.

## Sources and verification limits

- `apps/web/src/components/assignment-ai-grading.tsx`: suggestion controls, source checks, acknowledgement, and request lifecycle.
- `apps/web/src/app/(workspace)/academic/page.tsx`: integration above the manual rubric fields and separate grade submission.
- `apps/web/src/components/ai-task-settings.tsx`: administrator provider/model configuration.
- `apps/web/src/app/globals.css`: workspace animation fill and reduced-motion behavior.
- `apps/api/src/learning/ai-grading-assist.service.ts` and `ai-grading-store.service.ts`: authorized context, private identity, claim/replay, and uncertain-state handling.
- `apps/web/src/components/assignment-ai-grading.test.tsx`: regression cases for explicit reads/creation, review gating, unsupported sources, language/submission changes, duplicate requests, and timeout recovery.

This note is grounded in source inspection and the feature review handoff. The documentation pass did not independently rerun tests or call a live AI provider. Review screenshots use mocked data and demonstrate layout only; they do not establish provider connectivity, grading quality, live billing behavior, or production database operation. The limited ship disposition is a review outcome, not deployment confirmation or a claim of live AI validation.

## TXT extension — backend and frontend integrated

The backend now accepts verified UTF-8 TXT attachments in addition to inline text. It reads every attached file, rejects unsupported mixed formats, preserves source snapshots with checksums, and enforces 80,000 bytes per TXT file and 20,000 characters across all content and separators. It never truncates a submission to fit. Quotes must occur within one original source, not across an artificial source boundary. Metadata and permissions are rechecked before generation and current context is checked afterward.

The frontend accepts up to five TXT attachments, each at most 80,000 bytes. It checks that the response contains exactly the current attachment manifest plus any inline source, matches IDs/names and checksum format, and contains each quote within a single source. The browser does not independently hash the attachment bytes: checksum verification remains authoritative on the backend. Aggregate text is limited to 20,000 characters without truncation. PDF, images and Word remain unsupported, including mixed submissions containing these formats.

Verification: 91 frontend tests passed, typecheck/lint passed, and the 2,150-string UI catalog has no missing English translations. TXT regression cases cover explicit generation with revision/language only, attachment-only and mixed sources, malformed manifests, unsupported files, source-boundary quotes, and the manual review gate. API-mocked browser captures at 1440×1000 and 390×844 show expanded TXT sources and quotes, plus copying 4.5 points and feedback into the manual form without saving. Mobile dialog bounds were x=16…374 and y≈34…810 inside a 390×844 viewport, with equal scroll/client widths. Captures are local ignored artifacts under `output/playwright/grading-txt-*.png`.

Prior backend verification: 333 API tests passed, 9 configuration-gated tests skipped; the dedicated MySQL grading store suite passed 2 tests including source snapshot replay. Provider generation remains mocked in these tests. None of these checks establish live provider grading quality or successful live billing behavior.

## Administrator operations extension — limited ship review

`apps/web/src/components/ai-grading-operations.tsx` adds an Operate surface beneath `AiTaskSettings` in `apps/web/src/app/(workspace)/admin/settings/page.tsx`. It inherits the paper/ink ledger in `apps/web/DESIGN.md` and the existing product context in `apps/web/PRODUCT.md`: shared controls, ruled metadata rows, wrapping selectable identifiers, and stacked controls and fields on mobile. This bounded extension introduces no new visual world and requires no DESIGN.md or sidecar rewrite.

Both the frontend and `apps/api/src/learning/ai-grading-operations.ts` restrict access to `SYSTEM_ADMIN` with `system:configure`. An explicit reload reads `GET /admin/ai-operations/grading`; opening the panel does not fetch. The default filter includes `GENERATING` and `UNCERTAIN`, with individual state filters including `READY`. Rows expose only task, instructor and submission identifiers, language, state, and creation/update timestamps. The API requires durable database access and provides no answer, score, feedback, provider secret, retry, reset, or claim-deletion action.

The panel requests 20 rows per page and provides previous/next cursor navigation. Changing the filter clears the displayed snapshot and pagination history; a reload starts at the first page. Loading disables duplicate actions, and identity changes or unmounting discard the old panel and abort its request. Errors and the 30-second read timeout clear the visible data and offer manual reload, with no automatic retry. Creation/update timestamps are not completion times, and elapsed time does not prove that a task failed or that the provider did not process it.

The independent reviewer gave a limited ship disposition for this extension after code inspection and the local captures `.impeccable/review/ai-operations-desktop.png`, `.impeccable/review/ai-operations-mobile.png`, and `.impeccable/review/ai-operations-mobile-bottom.png`. The reported final frontend checks passed: 100 tests (including 9 operations tests), typecheck, lint, and a 2,170-string catalog with zero missing English translations. The documentation pass inspected source and recorded this handoff; it did not independently rerun those checks.

Visual evidence covers light-theme Vietnamese desktop/mobile screens with synthetic API fixtures. It does not establish other theme/locale layouts, live AI execution, grading quality, billing, production database behavior, or deployment. The disposition applies only to this administrator extension.

## Study operations selector extension

The same panel now offers a task-type selector for grading or study guides (summaries/flashcards). Study metadata comes from `GET /admin/ai-operations/study`: task ID, creator ID, material ID, source version, state, creation time and update time. No guide content, private edits, published content or generation options are displayed. The creator label is generic because it identifies the requesting account rather than asserting an instructor role.

Switching task type remounts the request panel with a key containing account identity and domain. This aborts the old read, discards late responses and clears its filter/history. Selecting a type alone makes no API request. Both queues retain explicit loading and read-only navigation; no retry/reset/deletion action was introduced.

The extension preserves the incumbent layout and adds a full-width labeled native selector. Parent verification passed 102 frontend tests (11 operations tests), typecheck, lint and the 2,174-string catalog check. A bounded browser pass inspected synthetic Vietnamese light-theme study metadata at desktop 1440×1000 and mobile 390×844, with captures `.impeccable/review/ai-study-operations-desktop.png`, `ai-study-operations-mobile.png` and `ai-study-operations-mobile-bottom.png`. The previous independent ship disposition predates this selector extension and is not claimed as a fresh review of it. Live provider, dark/English visual and screen-reader checks remain outside this evidence.

## Exam operations selector extension

The selector now also reads `GET /admin/ai-operations/exams`. Its six states distinguish a pre-generation claim, started processing, uncertain outcome, prepared AI draft, saving, and completed exam save. The default filter excludes completed saves; READY is explicitly a draft, not proof of a saved or published exam. Rows show task version rather than source version, and do not invent a submission/material identifier. The panel explains that only canonical requests with matching content bindings are listed; aliases and orphan claims are not a complete storage incident inventory.

This bounded extension uses the incumbent layout under the impeccable hardening workflow. Verification passed 103 frontend tests (12 operations tests), typecheck, lint, and the 2,183-string translation catalog check. The new regression checks the exam endpoint, exam-specific filters, draft semantics, version metadata and state reset on returning to grading. Synthetic Vietnamese light-theme captures were inspected at desktop 1440×1000 and mobile 390×844, including the reachable pagination footer: `output/playwright/ai-exam-operations-desktop.png`, `ai-exam-operations-mobile.png`, and `ai-exam-operations-mobile-bottom.png`.

No provider was invoked by this UI verification. Prior independent review does not cover this new extension. Live AI, English/dark visual checks, screen-reader testing, orphan-claim reconciliation, large-volume JSON-query performance and evidence-based recovery remain outside this result. No reset, deletion or automatic retry action was added.

## Unlinked-claim scope extension

Exam reconciliation now includes an explicit scope selector: linked original requests (default) or unlinked claims (`scope=unlinked`). The latter means no content binding matches owner and payload hash; linked retry aliases are excluded by the backend. The help text warns that a claim can still be in preparation and that a newly created binding can invalidate pagination. This is not a full audit of malformed bindings or missing canonical targets.

Changing scope clears data, cursor history and errors without fetching, while retaining the state filter. The scope control is disabled during reads; changing domain remounts the panel and restores canonical scope. No reset, deletion or provider retry is offered. The incumbent paper/ink layout is preserved under the impeccable hardening workflow.

Verification passed 104 web tests including 13 operations tests, typecheck and lint; 2,187 catalog strings have no missing translations. Synthetic Vietnamese light-theme desktop/mobile captures at 1440×1000 and 390×844 were inspected, including the footer, using the local `output/playwright/ai-exam-operations-*.png` captures (updated for this scope). Browser data is mocked; this does not prove live AI, production storage behavior, English/dark layout or screen-reader compatibility. No new independent review disposition is claimed.
