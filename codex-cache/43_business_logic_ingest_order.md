# 43. Business Logic Ingest Order
Date: 2026-02-12
Purpose: fast cache loading order for Codex sessions

## Recommended Read Order
1. `codex-cache/40_business_logic_overview.md`
2. `codex-cache/41_business_logic_user_flows.md`
3. `codex-cache/42_business_logic_rules_and_guards.md`

## Session Prompt Seed (Optional)
Use this short seed when starting a fresh Codex session:

```text
Load and prioritize business logic from:
1) codex-cache/40_business_logic_overview.md
2) codex-cache/41_business_logic_user_flows.md
3) codex-cache/42_business_logic_rules_and_guards.md

Treat these as runtime behavior references.
If code conflicts with docs, code is SSOT and docs must be updated.
```

## Update Rule
- When changing auth, character, chat/origchat, story extraction, payment, point, cms, or metrics logic:
  - update at least one of `40`, `41`, `42`.
  - keep this ingest-order file unchanged unless file names move.
