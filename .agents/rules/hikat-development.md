---
trigger: always_on
---

# HiKAT Workspace Rules

These rules apply to all work performed in the HiKAT repository.

## Source of truth

The documented HiKAT architecture and the requirements provided for the current implementation phase are authoritative.

Before implementing a phase:
- inspect the relevant project documentation;
- inspect the existing implementation;
- understand the dependencies between affected components.

Never replace an agreed architectural decision simply because another approach is technically possible.

If an implementation exposes a real architectural problem:
1. stop before making the architectural change;
2. explain the problem;
3. explain its impact;
4. propose the smallest reasonable change;
5. wait for explicit approval.

## Engineering philosophy

HiKAT is a small project maintained by a small team.

Optimize for:
1. correctness;
2. simplicity;
3. robustness;
4. maintainability;
5. security.

Do not design HiKAT as an enterprise-scale distributed system unless a concrete requirement requires it.

Avoid unnecessary:
- microservices;
- databases;
- queues;
- event buses;
- abstraction layers;
- background infrastructure;
- duplicated APIs;
- complex permission systems.

## Architecture boundaries

Follow the architecture documented for HiKAT.

General principles:

- The HiKAT Backend is the central application/API layer.
- The primary application API uses GraphQL.
- Do not introduce REST endpoints for application functionality unless a documented integration specifically requires HTTP endpoints outside GraphQL.
- Clients must not bypass the Backend to access infrastructure simply for convenience.
- The Backoffice must not access D1, R2, Pterodactyl, Modrinth, CurseForge, or infrastructure credentials directly.
- The Launcher must not contain infrastructure secrets.
- Cloudflare D1 is used for structured application data where documented.
- Cloudflare R2 is used for object/file storage where documented.
- External service integrations belong behind the appropriate HiKAT server-side component.
- Authentication and authorization must be enforced server-side.
- Current application roles are PLAYER and ADMIN unless the architecture documentation is explicitly changed.
- Do not invent granular Backoffice permissions unless explicitly requested.

## Component boundaries

Keep concerns separated.

UI components:
- display information;
- collect user input;
- call the defined application interface.

Backend components:
- enforce authorization;
- validate input;
- implement business logic;
- coordinate infrastructure and external services.

Infrastructure-specific implementation details must not leak unnecessarily into clients.

## API contracts

GraphQL schema changes are contracts.

When modifying GraphQL:
- keep schema, resolvers, types, validation, clients, and tests synchronized;
- avoid duplicate representations of the same domain concept;
- use typed inputs and outputs;
- return meaningful structured errors;
- never expose internal secrets or raw infrastructure credentials.

Do not create alternate APIs that duplicate existing GraphQL functionality.

## Data changes

Before changing persistent data structures:
- inspect current schema and migrations;
- preserve existing data when applicable;
- create proper migrations rather than manually mutating production data;
- keep migrations deterministic and reproducible.

Never delete or destructively migrate persistent data without explicit authorization.

## Testing

Every phase must include appropriate tests for the functionality introduced or modified.

Prefer:
- unit tests for isolated business logic;
- integration tests for component boundaries and storage/API behavior;
- targeted end-to-end or smoke tests for important user flows where practical.

Tests must verify behavior, not merely implementation details.

Do not create meaningless tests purely to increase test counts.

## Documentation

Update documentation when a phase changes:
- architecture;
- public contracts;
- setup procedures;
- environment requirements;
- important operational behavior.

Do not rewrite documentation unnecessarily when behavior has not changed.

## Phase-based Git workflow

Development is organized by complete implementation phases, not by individual file changes.

At the beginning of each implementation phase:

1. inspect `git status`;
2. synchronize the local repository safely if required;
3. start from the current intended `main`;
4. create one dedicated branch for the phase.

Use a descriptive branch name such as:

`phase/01-foundation`
`phase/02-authentication`
`phase/03-backoffice-news`

Do NOT create a new branch for every small modification.

All work belonging to the current phase remains on that phase branch.

## During a phase

Work autonomously through the complete requested phase.

You may:
- inspect files;
- modify multiple related files;
- create required files;
- run commands;
- run tests repeatedly;
- fix problems;
- refactor code directly required by the phase.

Do not commit after every small edit.

Use commits only when they represent meaningful logical progress or the final validated phase.

## Phase completion gate

A phase is NOT complete until:

- all requested functionality for the phase is implemented;
- no known required part of the phase remains as TODO;
- relevant tests pass;
- relevant lint/type checks pass when configured;
- the relevant production build succeeds;
- important integration paths have been validated;
- no debugging artifacts remain;
- no secrets have been introduced;
- the final diff has been reviewed for accidental changes.

If any required validation fails:

DO NOT merge into main.

Fix the problem on the phase branch and rerun the validation.

## Git safety

Never:
- force push;
- rewrite main history;
- use destructive reset/clean operations;
- discard unrelated user changes;
- merge failing code into main.

Do not automatically resolve ambiguous merge conflicts by deleting or replacing existing work.

If a merge conflict cannot be safely resolved from the documented requirements, stop and report it.

## Finishing a phase

Once the complete phase passes its completion gate:

1. create a clear final commit for the completed phase;
2. push the phase branch to the configured remote;
3. verify the pushed branch corresponds to the validated commit;
4. merge the validated phase branch into `main`;
5. run a final relevant smoke validation/build on the merged result;
6. if that validation succeeds, push `main`;
7. if post-merge validation fails, do not push a broken `main`; investigate and report the problem.

Do not merge or push `main` before the phase passes all required validation.

## Final phase report

After finishing a phase, return one concise report with:

### Phase
Name and objective.

### Git
- branch name;
- final phase commit SHA;
- resulting main commit SHA if merged;
- push status.

### Implementation
Summary of what changed.

### Files
Important files created or modified.

### Validation
Exact commands executed and their observed results:
- tests;
- lint;
- typecheck;
- build;
- other relevant validation.

### Issues
Any limitation, unresolved problem, pre-existing failure, or architectural concern.

Do not begin the next phase automatically.

Stop after the phase report and wait for the next instruction.