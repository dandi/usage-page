# Agent instructions

- Always run `pre-commit` before committing and pushing changes
- Always bump the version in `package.json` appropriately when any file under `src/`, or `package.json` itself, is changed
- Leave a short description of the change or addition in the top `# Upcoming` section of the `CHANGELOG.md`; include the GitHub PR link at the end of each entry in the format `([#N](https://github.com/dandi/usage-page/pull/N))`
- Keep changelog entries concise: one sentence each, two at the very most. Say what changed and, where it is not obvious, why; leave implementation details, reasoning, and exhaustive lists of options or labels to the PR description
- PR titles should be human-readable and in the past tense; they should NOT use conventional commit style
- Use American English spelling everywhere (code, comments, UI text, changelog entries, and PR descriptions): "normalize" not "normalise", "color" not "colour", "behavior" not "behaviour"
