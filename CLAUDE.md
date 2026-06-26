# CLAUDE.md

**Load the `deepspace` skill before working in this repo.** It is the source
of truth for the SDK — invoke it via the Skill tool first, then read project
source for repo-specific details.

The skill is installed by the scaffold at `.agents/skills/deepspace/SKILL.md`
(for Claude Code agents, a `.claude/skills/deepspace` symlink is also
created so Claude Code picks it up).
Restart your agent session so it picks up the new skill — or, to keep
working without a restart, Read `.agents/skills/deepspace/SKILL.md` directly
(loading `references/*` on demand).

If the file doesn't exist, scaffold-time install failed (typically a network
issue). Install (or reinstall) it manually:

```sh
npx deepspace skills add -y                  # install into this project
npx deepspace skills add -g -y               # install globally for every project
npx deepspace skills add --agent codex -y    # specific agent
```

If you can't install it at all, read SKILL.md directly:
<https://github.com/deepdotspace/deepspace-skill/blob/main/skills/deepspace/SKILL.md>

## About this project

This is a **DeepSpace** app — a real-time collaborative app built on the
[`deepspace`](https://www.npmjs.com/package/deepspace) SDK and deployed to
Cloudflare Workers via `npx deepspace deploy`.

## Project commands

```sh
npx deepspace login        # authenticate with app.space
npx deepspace dev          # local dev server (vite + miniflare)
npx deepspace deploy       # deploy to <app>.app.space
npx deepspace add --list   # list optional features (messaging, etc.)
npx deepspace add <feature>
```

