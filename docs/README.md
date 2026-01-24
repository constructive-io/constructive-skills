# Documentation System

This directory contains the in-repo planning and specification system for Constructive Skills.

## Concepts

**Plan** — A proposal, blueprint, or work-in-progress design. Plans are iterative, may contain open questions, and are not authoritative. They live in `docs/plan/`.

**Spec** — An accepted contract and source of truth. Specs define reference behavior that reviewers and tests enforce. They live in `docs/spec/`.

## Promotion Flow

```
plan (Draft) → plan (In Review) → plan (Accepted) → spec
```

When a plan reaches **Accepted** status, it is promoted into `docs/spec/` as a formal specification.

## Rules

1. **Plans are not contracts.** They may be messy, incomplete, or exploratory.

2. **Specs are contracts.** They must remain accurate and are the authoritative reference for implementation and testing.

3. **Specs may describe future behavior** only when Decision Status = Accepted. This allows specs to document planned work before implementation begins.

4. **Status fields are authoritative.** Update them as work progresses. Specs track two independent dimensions:
   - **Decision Status** (contract lifecycle): Draft, Accepted, Deprecated, Superseded
   - **Implementation Status** (delivery lifecycle): Not Implemented, In Progress, Partial, Implemented, Blocked

5. **Architecture uses Constructive tooling.** Designs should leverage constructive-skills and interoperable Constructive patterns where applicable.

## Directory Structure

```
docs/
├── README.md              # This file
├── plan/
│   ├── README.md          # Plan guidelines
│   └── template.plan.md   # Plan template
└── spec/
    ├── README.md          # Spec guidelines
    └── template.spec.md   # Spec template
```
