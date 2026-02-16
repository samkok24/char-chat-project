# 41. Business Logic User Flows
Date: 2026-02-12
Scope: frontend-triggered runtime flows

## Flow 1. Signup, Verification, Login, Password Reset
Frontend entry:
- Pages: `/login`, `/verify`, `/forgot-password`, `/reset-password`
- API: `authAPI.*`

Backend path:
1. `POST /auth/register`
2. Duplicate email or username is rejected.
3. If pre-verified email token exists in Redis, user is immediately marked verified.
4. Otherwise verification email is sent when verification policy is enabled.
5. `POST /auth/login` blocks unverified accounts when policy requires verification.
6. `POST /auth/forgot-password` returns a generic success even for unknown email (anti-enumeration).
7. `POST /auth/reset-password` enforces minimum password policy (length and character mix), validates token, and re-checks verification policy.

## Flow 2. Character Quick Create (30s)
Frontend entry:
- Page: `/characters/create`
- API: `charactersAPI.quickCreateCharacter30s`

Backend path:
1. `POST /characters/quick-create-30s` receives one-shot payload.
2. Required fields are validated (`image_url`, `audience_slug`, `style_slug`, `name`, `one_line_intro`).
3. If `request_id` exists:
  - Read idempotency cache (`quick-create-30s:{user}:{request_id}`).
  - Acquire lock key (`...:lock`) to block parallel duplicates.
4. Required generated content is built (opening and two endings are treated as hard requirements).
5. Character is created as public by default (`is_public=true` fixed in this flow).
6. Tags are attached; failure is treated as flow failure.
7. Idempotency cache stores created character id, lock is released.

Key outcome:
- User receives a fully created character detail payload, not a draft.

## Flow 3. Standard Character Chat
Frontend entry:
- Page: `/ws/chat/:characterId`
- API: `chatAPI.startChat`, `chatAPI.startNewChat`, `chatAPI.sendMessage`

Backend path:
1. `POST /chat/start` or `POST /chat/start-new`.
2. Private character/story access is checked before room use.
3. If `opening_id` exists, intro and first line are resolved from `start_sets`; otherwise greeting fallback is used.
4. `POST /chat/message` validates room ownership and character match.
5. Optional room settings patch is applied through a whitelist:
  - `postprocess_mode`, `next_event_len`, `response_length_pref`, `prewarm_on_start`, `temperature`.
6. Turn computation uses room meta cache and Redis short lock to avoid race-driven turn duplication.
7. Runtime context (turn events, setting memos, stat state) is injected from `start_sets` and room meta.

## Flow 4. Origchat Start and Turn
Frontend entry:
- Story pages and chat transitions
- API: `origChatAPI.start`, `origChatAPI.turn`

Backend path:
1. `POST /chat/origchat/start`
2. Accepts `force_new` variants (`force_new`, `forceNew`, `force-new`).
3. Enforces plain mode as current policy.
4. Deleted story resolves to `410`.
5. Private story/character blocks non-owner/non-admin (`403`).
6. If allowed and not forced new, existing room reuse is attempted (with fallback for missing Redis meta).
7. When new room is created, `origchat:story:{story_id}:starts` is incremented.
8. Room meta is initialized with mode and runtime defaults.
9. `POST /chat/origchat/turn`
10. Accepts text, choice, or situation input styles and persists user-side events.
11. Supports idempotency via `idempotency_key` and `last_idem_key` short-circuit.
12. Applies same settings whitelist and guards around pending choice state.

## Flow 5. Story CRUD, Generation, and Extracted Characters
Frontend entry:
- Pages: `/stories/:storyId`, `/stories/:storyId/edit`, `/works/create`
- API: `storiesAPI.*`

Backend path:
1. Story detail/context endpoints enforce private story guard (owner/admin).
2. Story update:
  - Owner can update normally.
  - Admin non-owner can only update `is_public`.
3. Story likes require public story.
4. Story comments on private story require owner.
5. `POST /stories/generate/stream` creates and updates stream job states for SSE clients.
6. Extracted characters:
  - Sync rebuild runs cleanup first.
  - Async rebuild creates job record before background task starts (prevents early polling race).
  - Status is mirrored in Redis (`in_progress`, `completed`, `cancelled`, `failed`, `error`).
  - Cancel endpoint marks cancelled and performs best-effort cleanup.

## Flow 6. Payment and Point
Frontend entry:
- Page: `/ruby/charge`
- API: `paymentAPI.*`, `pointAPI.*`

Backend path:
1. `POST /payment/checkout`
2. Validates active product.
3. Creates pending payment row and returns checkout URL.
4. `POST /payment/webhook`
5. Looks up payment by order id.
6. If status is already non-pending, returns `Already processed` (idempotency).
7. On success, invokes `PointService.charge_points`.
8. `POST /point/use` invokes `use_points_atomic` (Redis Lua) for atomic decrement under concurrency.
9. Point DB transaction write is persisted after atomic path; failures are isolated from immediate API response.

## Flow 7. CMS and Metrics (Ops)
Frontend entry:
- Pages: `/cms`, `/metrics/summary`
- API: `cmsAPI.*`, `metricsAPI.*`

Backend path:
1. CMS public GET endpoints expose current home configuration.
2. CMS PUT endpoints require admin and persist shared config (with schema compatibility fallbacks).
3. Metrics heartbeat endpoint records online presence in Redis with TTL-based cleanup.
4. Online-now and traffic summary endpoints are admin-only.
5. Content-counts endpoint returns cached aggregate counts with defensive cache write/read rules.
