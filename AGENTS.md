# MedSafe UI improvement instructions

Apply these instructions only for visual UI, interaction, accessibility, responsive-layout, or interface-copy work.

## Required reference reading

Before planning or editing the interface, read these sibling reference files in order:

1. `../anti-slop-main/antislop.md`
2. `../anti-slop-main/skills/antislop-layoutmobile/SKILL.md`
3. `../claude-code-best-practice-main/README.md`
4. `docs/UI_VISUAL_IMPROVEMENT_GUIDE.md`

Treat the first two as the UI and mobile-layout quality filter. Follow the Anti-Slop usage-mode process before making visual changes. Treat the Claude Code reference as workflow guidance only: use its planning, small-step, and verification practices, but do not add Claude-specific tooling or configuration to MedSafe.

## Preserve the application

- Keep the existing plain HTML, CSS, and native JavaScript module stack.
- Do not redesign the information architecture, rename routes/pages, replace the HTML shell, add a framework, or change medicine, storage, interaction, or AI-service behavior for a visual-only task.
- Do not alter clinical wording, interaction severity, model output, or safety boundaries unless the task explicitly requests it and qualified review is available.
- Keep `index.html` markup stable where possible. Make visual changes primarily in `assets/css/app.css` and `assets/css/mobile.css`.
- Keep all existing buttons, forms, search, add/remove, stock, navigation, modal, and interaction-check flows working.

## Required quality bar

- Improve hierarchy, spacing, contrast, button states, focus states, and feedback without adding decorative or nonfunctional UI.
- Keep button and form controls touch-friendly (minimum 44px targets) and keyboard-accessible.
- Treat mobile as a distinct layout at the existing phone/tablet breakpoints; prevent horizontal overflow and ensure fixed navigation never obscures content.
- Prefer deliberate, product-specific refinements over generic landing-page sections, fabricated claims, testimonials, statistics, or placeholder features.
- Verify desktop, tablet, and phone widths, then run `npm run check` and `npm test` after changes.

## Change process

1. Inspect the current affected HTML and CSS before editing.
2. State the intended visual improvements and why each one helps usability.
3. Make small CSS-first changes.
4. Verify affected interactions and responsive views.
5. Report changed files, tests run, and unverified device checks.
