# 40. Business Logic Overview
Date: 2026-02-12
Scope: `frontend/char-chat-frontend`, `backend-api`

## Objective
Summarize the current production-facing business logic from code behavior (not planning docs).

## Frontend-First Entry Points
- Router entry: `frontend/char-chat-frontend/src/App.jsx`
- API contract entry: `frontend/char-chat-frontend/src/lib/api.js`
- Core user surfaces:
  - Auth: `/login`, `/verify`, `/forgot-password`, `/reset-password`
  - Character: `/characters/create`, `/characters/:characterId`, `/my-characters`
  - Chat: `/ws/chat/:characterId`
  - Story: `/stories/:storyId`, `/stories/:storyId/edit`, `/works/create`
  - Payment: `/ruby/charge`
  - Ops: `/cms`, `/metrics/summary`

## Business Domains
- Auth and identity
  - Registration, login, refresh, email verification, password reset.
  - Verification is policy-gated (`EMAIL_VERIFICATION_REQUIRED`) and enforced in login and reset flows.
- Character lifecycle
  - Standard create/update/delete and advanced generation.
  - Quick 30-second creation endpoint assembles required story/chat scaffolding in one transaction-like flow.
- Chat runtime
  - Standard character chat and origchat share room/message primitives but have different policy and context handling.
  - Room meta is used as runtime SSOT for turn and generation settings.
- Story lifecycle
  - CRUD, likes/comments, generation stream jobs, extracted character rebuild (sync/async), announcements.
- Billing and points
  - Product checkout and payment webhook.
  - Point balance cache and atomic point usage.
- CMS and metrics
  - Public read + admin write CMS configuration.
  - Runtime telemetry and online presence counters.

## Core Aggregates and States
### User
- Auth states: active/inactive, verified/unverified.
- Preconditions:
  - Duplicate email/username rejected during registration.
  - Unverified users blocked where verification is required.

### Character
- Visibility states: public/private.
- Mode states: regular/origchat-linked (`origin_story_id` exists).
- Ownership rules:
  - Non-owner cannot mutate character and settings.
  - Private character detail blocked for non-owner/non-admin.

### Chat Room
- Runtime state lives in room meta:
  - `response_length_pref`, `temperature`, `postprocess_mode`, `next_event_len`, `prewarm_on_start`.
  - `turn_no_cache`, `stat_state`, `pending_choices_active`, `last_idem_key`.
- Opening state:
  - `opening_id` binds intro/first line and downstream turn-event/stat progression.

### Story
- Visibility states: public/private.
- Origchat readiness: `is_origchat`.
- Derived entities:
  - Extracted characters and their downstream artifacts (rooms/messages/grid links).
- Announcement state:
  - Supports single pinned announcement semantics.

### Payment and Point
- Payment states: pending/success/failure.
- Point state:
  - Redis cached balance (`points:{user_id}`) with DB-backed reconciliation.
  - Atomic decrement via Redis Lua script.

## Cross-Domain Dependencies
- `Character.origin_story_id` links character visibility to story visibility in public listings.
- Origchat room creation increments `origchat:story:{story_id}:starts` for story-level ranking/use signals.
- Payment webhook success charges user points.
- Story extracted-character rebuild can create/delete origchat-linked artifacts.

## Source Files (SSOT for this summary)
- `frontend/char-chat-frontend/src/App.jsx`
- `frontend/char-chat-frontend/src/lib/api.js`
- `backend-api/app/api/auth.py`
- `backend-api/app/api/characters.py`
- `backend-api/app/services/character_service.py`
- `backend-api/app/api/chat.py`
- `backend-api/app/api/stories.py`
- `backend-api/app/services/story_service.py`
- `backend-api/app/api/payment.py`
- `backend-api/app/api/point.py`
- `backend-api/app/services/point_service.py`
- `backend-api/app/api/cms.py`
- `backend-api/app/api/metrics.py`
