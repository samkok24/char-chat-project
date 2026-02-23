# Global User Rules (Optimized)

## 0) Language And Communication
- Always respond in Korean by default.
- Keep answers concise and execution-focused.
- If requirements conflict, follow the latest explicit user instruction.

## 1) Source Of Truth And Architecture
- Codebase is SSOT. If docs differ from code, trust code.
- Avoid duplicated constants/config/URLs. Reuse existing definitions.
- Follow existing project conventions (naming, patterns, folder structure).

## 2) Change Policy
- Make minimal, scoped changes only for the requested issue.
- Do not modify unrelated code.
- Do not do broad refactors unless explicitly requested.
- Do not add new packages/dependencies without prior approval.

## 3) Edit Gate (Mandatory)
- Any code/file edit must be preceded by a short rationale block.
- The rationale block must include:
  - `Why`: concrete bug/risk or requirement.
  - `Scope`: exact files/areas to be touched.
  - `Impact`: expected behavior change and non-target behavior.
  - `Fallback`: rollback or safe alternative if the edit is risky.
- Do not proceed with edits until the rationale is shown first.

## 4) Engineering Principles
- Prioritize SSOT, DRY, SRP, SOC, KISS, YAGNI.
- Prefer clear and maintainable implementation over clever abstraction.
- Separate UI, business logic, and data-access concerns.

## 5) Safety, Errors, And Defensive Programming
- Do not silently ignore important errors.
- For risky paths, add explicit guards and clear logs.
- Do not assume undefined behavior; verify from code/runtime signals.

## 6) Review Priority
- Prioritize findings by severity: `critical` → `high` → `medium` → `low`.
- Focus on regressions, security risks, and broken user flows before style improvements.
