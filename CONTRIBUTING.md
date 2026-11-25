# Contributing

## Setup
Follow the "Run the database and seed it" section of the [README](README.md). Node 20+ is required (`nvm use` reads `.nvmrc`).

## Workflow
1. Branch from `main`: `git switch -c feat/short-description`.
2. Make small, focused commits using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
3. Before pushing, run `npm run typecheck` and `npm test`.
4. Open a pull request against `main` and describe what changed and why.

## Style
Formatting is defined in `.editorconfig` and `.prettierrc.json` (LF line endings, 2-space indent). Run `npm run format` to apply it.
