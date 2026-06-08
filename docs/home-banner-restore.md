# Home Banner Restore Guide

## Current State

- The home main banner is hidden for payment review.
- The runtime switch is `SHOW_HOME_BANNER = false` in `frontend/char-chat-frontend/src/pages/HomePage.jsx`.
- `HomeBannerCarousel` and CMS banner management are kept in the codebase, but the home page does not render the banner while the flag is false.
- The sections below the banner are pulled up because the banner node is not mounted.

## Restore Principle

Do not simply flip the old banner back on.

When the banner is restored, expose a new banner version:

- Create or select a new CMS banner set first.
- Keep old review-period banners disabled or archived unless each banner is re-approved for the new surface.
- Confirm the new banner copy, image, link target, schedule, and mobile layout before enabling the code flag.
- Avoid banner copy that can conflict with payment review, legal review, or SEO positioning.

## Restore Steps

1. Prepare the new CMS banner version.
2. Verify the CMS banner status, schedule, image URLs, and link targets.
3. Change `SHOW_HOME_BANNER` from `false` to `true` in `frontend/char-chat-frontend/src/pages/HomePage.jsx`.
4. Run the frontend build from `frontend/char-chat-frontend`.
5. Browser-check the home page on desktop and mobile widths.
6. Confirm the banner appears, the below sections keep proper spacing, and there is no layout jump.
7. Follow the project release flow unless the user explicitly overrides it:
   `dev commit -> dev push -> main merge -> main push -> version tag`.

## Rollback

If the banner causes review, layout, or content risk:

1. Set `SHOW_HOME_BANNER = false`.
2. Disable the problematic CMS banner set.
3. Rebuild and redeploy.
