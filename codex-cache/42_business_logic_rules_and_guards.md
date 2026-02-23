# 42. Business Logic Rules and Guards
Date: 2026-02-12
Type: invariants and defensive rules

## Visibility and Permission Rules
| Area | Rule | Current Behavior |
| --- | --- | --- |
| Auth | Verification policy gate | Login/reset are blocked for unverified user when verification policy is enabled. |
| Character detail | Private access | Private character is visible only to owner or admin. |
| Character mutate | Ownership gate | Update/delete/settings/tag operations require owner (or admin where explicitly allowed). |
| Character public list | Origchat visibility coupling | Origchat character is listed only when linked origin story is public; defensive second filter exists in API layer. |
| Story detail/context | Private access | Private story access requires owner or admin. |
| Story update | Admin scope restriction | Admin non-owner can patch only `is_public`. |
| Story like/comment | Public gating | Like requires public story; private-story comments are restricted. |
| Origchat start/turn | Private and deleted guard | Deleted story returns `410`; private story/character returns `403` for non-owner/non-admin. |
| CMS write | Admin-only | Public reads are open, writes require admin permission check. |
| Metrics ops | Admin-only | Online-now and traffic endpoints are admin-only. |

## Idempotency and Duplicate-Prevention Rules
| Area | Key | Behavior |
| --- | --- | --- |
| Quick character create | `quick-create-30s:{user}:{request_id}` | Returns existing created character when request repeats. |
| Quick character create lock | `...:lock` | Concurrent identical requests are blocked with conflict. |
| Origchat turn | `idempotency_key` vs `room.meta.last_idem_key` | Duplicate turn request returns last AI message (short-circuit). |
| Payment webhook | payment status check | Non-pending payment returns `Already processed` without re-crediting points. |

## Room Meta and Runtime-Control Rules
- Settings patch whitelist applies in both standard chat and origchat turn:
  - `postprocess_mode`, `next_event_len`, `response_length_pref`, `prewarm_on_start`, `temperature`.
- `temperature` is clamped to a 0..1 range and rounded defensively.
- Turn progression uses room meta cache and a short Redis lock to reduce concurrent turn number collisions.
- Pending-choice state blocks invalid next-event progression until state is resolved.

## Consistency and Cleanup Rules
| Area | Rule | Behavior |
| --- | --- | --- |
| Character delete | Cascading cleanup | Linked story-extracted rows, chat artifacts, likes/comments/bookmarks/tags/settings/memory are cleaned before final delete. |
| Story extracted rebuild | Cleanup-first | Existing origchat artifacts are removed before rebuild to avoid orphan leftovers. |
| Extracted async cancel/failure | Idempotent cleanup | Cancel/failure paths attempt cleanup and status updates repeatedly as needed. |
| Story extracted job race | Job-first creation | Job record is created before background work to avoid frontend polling 404 race. |

## Cache and TTL Rules
| Area | Key/Scope | TTL/Policy |
| --- | --- | --- |
| Auth pre-verification | `auth:preverified_email:{email}` | Used at registration to auto-verify prevalidated email. |
| Point balance | `points:{user_id}` | 300s TTL cache with DB fallback on miss. |
| Extract status | `extract:status:{story_id}` | Uses status-specific TTL (`in_progress`, `completed`, `cancelled`, `failed`, `error`). |
| Online presence | Redis ZSET | Heartbeat updates with sliding TTL cleanup. |
| Content counts | `metrics:content_counts:{day}` | Cache persisted only when total is non-zero and query had no partial failure. |

## Eventual-Consistency Notes
- Point usage is atomically decremented in Redis first; DB transaction logging follows and can lag/fail independently.
- Redis metadata may be missing after restart; origchat start/turn includes fallback recovery paths to avoid user-visible flow breaks.
- Story extraction cancellation is best-effort immediate, then reinforced by worker-side checks.

## Operational Risks to Track
- Payment webhook signature/IP validation is marked TODO and should be hardened before full external PG integration.
- Heavy runtime dependence on Redis meta means observability on key expiry and restart behavior is important.
