# Browser Verification Contract

Verify the updated local build independently in the in-app Browser and Chrome. Do not substitute one
surface for the other and do not stop the existing preview on port 4321.

## Desktop Journeys

- `/library`: public books render; details and reading navigation work.
- `/manage`: authenticated import/task entry renders with private/no-store behavior.
- `/manage/tasks`: queue, running/recent attempt, stage duration and RSS state render without unsafe
  names or paths.
- Publishing workbench: current draft and candidate status load; preview opens.
- Preview and published reader: generated content, assets, previous/next navigation and nested table
  of contents work.

## Responsive Journey

At one mobile-sized viewport, inspect library, management/publishing and reader navigation. Controls
remain reachable; text and panels do not overlap or create an unusable blank canvas.

## Failure Inspection

For each surface inspect visible errors, console errors and failed required network requests. Expected
authentication redirects or deliberately unavailable optional resources must be identified rather
than counted as application regressions.
