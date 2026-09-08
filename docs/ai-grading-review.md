# AI grading assistance: implementation and UX review

Disposition: ship within the limited scope of private, instructor-reviewed suggestions for text-only assignment submissions. This extends the existing academic grading modal and administrator AI task settings; it introduces no new visual identity or changes to the product's broader claims.

## User flow

1. An instructor with `exam:manage` opens a submission in the existing grading modal. Opening the panel does not fetch or generate a suggestion. Empty answers and submissions with any attachment remain manual-only, including submissions that also contain text.
2. The instructor chooses Vietnamese, English, or bilingual suggestion output, then explicitly checks the saved suggestion with `GET /instructor/assignment-submissions/:id/ai-suggestion`.
3. Only a `NOT_REQUESTED` response exposes the create action. The accompanying notice explains that the answer and rubric go to the administrator-configured model and may incur a charge. The explicit `POST` sends the expected submission revision and language; instructors cannot supply the model or override source content.
4. A ready result displays the model, proposed total, rubric criterion scores and reasoning, expandable quoted evidence, and proposed feedback. Suggestions remain private to their requesting instructor and do not constitute an official grade. An insufficient-evidence result provides feedback without an action to copy scores.
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

## Backend TXT extension — frontend integration pending

The backend now accepts verified UTF-8 TXT attachments in addition to inline text. It reads every attached file, rejects unsupported mixed formats, preserves source snapshots with checksums, and enforces 80,000 bytes per TXT file and 20,000 characters across all content and separators. It never truncates a submission to fit. Quotes must occur within one original source, not across an artificial source boundary. Metadata and permissions are rechecked before generation and current context is checked afterward.

This extension does not yet change the frontend flow above: the current panel still rejects submissions with attachments. PDF, images and Word files remain unsupported by the grading pipeline. Backend verification for this increment: 333 API tests passed, 9 configuration-gated tests skipped; the dedicated MySQL grading store suite passed 2 tests including source snapshot replay. Provider generation in these tests is mocked, not live AI.
