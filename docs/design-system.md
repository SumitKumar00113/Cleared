# Cleared frontend design system

## Direction

The workspace uses a calm, tactile soft futurist direction: forest green and mint carry the brand, warm paper and layered surfaces keep long work sessions readable, and a muted lilac is reserved for keyboard focus and secondary data accents. The visual language stays dimensional through fine borders, a single soft shadow direction, small highlights, and restrained translucency in navigation chrome.

## Type

All typefaces are bundled locally from Fontsource; the app does not request Google Fonts. DM Sans handles interface copy at regular 400 and medium 500. Newsreader regular 400 and italic 400 is reserved for editorial emphasis and the large queue count. IBM Plex Mono regular 400 and medium 500 is used for timestamps and compact metadata. Small labels remain at least 12px; body copy is 14–15px or larger. No interface text uses a weight above 500.

## Layout and surfaces

The workspace uses a 12-column responsive grid with an 8px spacing rhythm. Overview allocates seven columns to the review queue and five to activity and source health. Its pipeline is a connected band with one oversized count instead of separate metric cards. The surface palette exposes three shadow levels (`--ds-shadow-1` through `--ds-shadow-3`) with a shared light direction. Controls use a faint inset highlight and quiet gradient only for the primary action.

## Components

`apps/web/src/design-system.jsx` contains the shared button, input, select, badge, panel, table, tabs, progress, chart frame, empty state, command palette, and responsive workspace rail primitives. `design-system.css` defines the tokens, elevation levels, keyboard focus, compact expandable rail, and mobile bottom navigation. `overview.css` composes those primitives into the current Overview checkpoint.

## Interaction and accessibility

The navigation rail expands on request and the command palette opens with Ctrl/Cmd+K. Mobile navigation stays at the bottom with 44px-or-larger targets. Focus rings use a muted lilac. Translucent chrome is limited to navigation; `prefers-reduced-transparency` removes blur. Reduced-motion preferences disable rail and button transitions. The Overview activity feed reads real audit events and is shown only to roles authorized by the existing audit endpoint.

## Checkpoint scope

The Overview is the first redesigned workspace screen. Other workspace screens retain their existing layouts until the user reviews this checkpoint. The public landing page has its own styles in `LandingPage.css`; the shared tokens and primitives documented here apply to the signed-in workspace. The display label uses an existing display name when present, otherwise it derives a readable label from the email address; no identity schema or API changed.
