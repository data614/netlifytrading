# Browser & Responsive Validation Plan

This document outlines the validation plan for confirming cross-browser compatibility and responsive layout behavior for the Good Hope trading desk experience.

> **Note:** Automated cross-browser execution is not available in the current environment. The matrix below documents the manual verification steps to execute on target browsers and screen sizes.

## Target Browsers

| Browser | Rendering Engine | Minimum Version | Status | Notes |
|---------|------------------|-----------------|--------|-------|
| Google Chrome | Blink | 120+ | ✅ Pending human validation | Validate gradient background, sidebar blur fallback, and `flex` stacking. |
| Microsoft Edge | Blink | 120+ | ✅ Pending human validation | Confirm safe-area padding on nav and responsive sidebar stacking. |
| Mozilla Firefox | Gecko | 122+ | ✅ Pending human validation | Verify scroll snapping for nav links and table overflow behaviour. |
| Apple Safari | WebKit | 17+ | ✅ Pending human validation | Confirm safe-area inset padding, backdrop-filter fallback, and mobile stacking at ≤820px. |
| DuckDuckGo Browser | Blink/WebKit | Latest | ✅ Pending human validation | Follow Chrome/Safari steps depending on platform. |
| Tor Browser | Gecko | 13.0+ | ✅ Pending human validation | Disable “Safest” mode for chart rendering; confirm gradient fallback colour. |

## Responsive Breakpoints to Exercise

1. **Desktop (≥1280px width)** – Validate two-column layout, scrollable sidebar, and card elevations.
2. **Large Tablet (~1024px width)** – Confirm typography scaling, card padding adjustments, and chart resizing.
3. **Tablet Portrait (820px width)** – Ensure sidebar stacks below main content and retains border-top separation.
4. **Large Mobile (680px width)** – Validate watchlist and nav link horizontal scrolling.
5. **Small Mobile (520px and 420px widths)** – Confirm reduced paddings, one-column clock grid, and maintain accessible tap targets.

## Test Procedure

1. Open `index.html` in the target browser.
2. Resize viewport (or use dev tools device simulation) to each breakpoint listed above.
3. For each viewport:
   - Ensure no horizontal scroll is introduced.
   - Confirm the market movers table is scrollable within its card on narrow widths.
   - Validate typography hierarchy and button tap targets remain legible.
4. Interact with navigation links, watchlist items, and chart time-frame buttons to confirm hover/focus states render consistently.
5. Toggle operating system light/dark appearance and reduced motion settings to ensure gradients, transitions, and focus outlines remain visible.

## Accessibility Quick Checks

- Confirm keyboard navigation flows correctly through nav links, chart controls, and sidebar forms.
- Screen-reader hint: the market movers data region exposes a descriptive `aria-label` for clarity when the table scrolls.
- Reduced motion preference removes animations and enforces instant transitions.

## Reporting

Capture screenshots or notes for each browser/viewport combination and store them alongside release artifacts. Document any deviations and cross-reference CSS adjustments in `app.css` for follow-up fixes.
