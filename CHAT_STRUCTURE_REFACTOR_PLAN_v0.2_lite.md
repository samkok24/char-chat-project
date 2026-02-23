# General Chat Refactor Plan v0.3-lite

Date: 2026-02-20  
Goal: match babechat-like perceived speed without re-platforming

## 1) Scope

- In scope
  - General character chat only
  - Token chunk streaming
- Out of scope
  - OrigChat redesign
  - Full observability dashboard project
  - Prompt quality retuning

## 2) New benchmark facts (babechat, confirmed)

- Transport: `POST` + `content-type: text/event-stream` (SSE)
- Streaming header: `x-vercel-ai-ui-message-stream: v1`
- Event pattern:
  - `start`
  - `start-step`
  - `text-start`
  - repeated `text-delta`
  - `text-end`
  - `finish-step`
  - `finish`
  - `[DONE]`
- Practical implication:
  - Users see first characters immediately
  - Final REST history is still complete-message based

## 3) Core gap vs us

- Current path waits for full completion before emitting one `new_message`
- This is the primary reason for slow perceived response

## 4) Lite target architecture (updated)

1. Add backend SSE endpoint
   - `POST /chat/messages/stream`
2. Keep current socket architecture, but stream through it
   - chat-server consumes SSE and emits:
     - `ai_message_start`
     - `ai_message_chunk`
     - `ai_message_end`
3. Keep history/storage contract unchanged
   - save final assistant message at end
   - sender gets chunk UX, room history remains stable

Why this shape:
- Minimal change to existing frontend and multi-device sync
- No Vercel dependency required

## 5) Protocol compatibility target

- We do not need exact Vercel SDK adoption.
- We do need equivalent semantics:
  - start signal
  - delta chunks
  - explicit end
  - done marker

Recommended internal event payload:
- `ai_message_start`: `{ requestId, roomId, messageId }`
- `ai_message_chunk`: `{ requestId, roomId, messageId, seq, delta }`
- `ai_message_end`: `{ requestId, roomId, messageId, content, finishReason }`

## 6) Execution tickets (4)

1. `LITE-01` Backend stream endpoint
   - Files: `backend-api/app/api/chat.py`, `backend-api/app/services/ai_service.py`
2. `LITE-02` chat-server stream bridge
   - File: `chat-server/src/controllers/socketController.js`
3. `LITE-03` feature flag rollout
   - Flag: `CHAT_STREAMING_ENABLED`
   - Off => fallback to existing `/chat/messages`
4. `LITE-04` minimal validation
   - Compare only:
     - p95 TTFT
     - p95 completion time
     - error rate

## 7) KPI (minimum)

- `p95 TTFT <= 1.5s`
- `p95 completion <= 8.0s`
- `error rate <= 1%`

## 8) Rollback

- Trigger:
  - error spike
  - missing/duplicated messages
- Action:
  - set `CHAT_STREAMING_ENABLED=false`

## 9) Done criteria

- First chunk appears before full response completion
- No regression in send/history behavior
- KPI minimum set improves vs baseline
