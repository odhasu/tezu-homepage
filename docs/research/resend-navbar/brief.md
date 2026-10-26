# Resend navigation adapted for Tezu

## Route and ownership

The navigation from https://resend.com/ is adapted to the existing Tezu homepage at `/` (GitHub Pages: `/tezu-homepage/`). No Resend page or destination is cloned. Tezu's logo, Suisse Intl typeface, navigation labels, app destinations, integration-tab selection, hero, and galleries stay in place.

- `src/components/sites/krea/SiteHeader.tsx`: opt-in `resend` appearance, shared navigation behavior, mobile drill-down panels and focus restoration.
- `src/components/sites/krea/SiteHeader.module.css`: scoped reference geometry and surfaces.
- `src/components/sites/krea/TezuSiteHeader.tsx`: enables the appearance and supplies the local texture URL.
- `public/sites/resend/texture-btn.png`: original texture from https://resend.com/static/texture-btn.png, verified PNG, 442×48.

The canonical authoring app is `apps/krea` in the website-cloner workspace. The deployment repository maps that app to its root.

## Observed source rules

Desktop at 1440px: 58px bar, 1280px maximum container including 24px side padding, logo left, navigation centered between flexible side slots, actions right. Links use 14px/20px medium type and 12px horizontal padding. The glass CTA is 40px tall with a 16px radius, two-pixel translucent border, 25px backdrop blur, subtle texture and gradient. Hover turns the CTA pale with dark text. The scrolled header uses black at 60% opacity, texture and 12px blur, with a one-second fade from 16px above (`ease-in-out`).

The dropdown is centered below the bar, with a 24px radius, hairline border, 20px padding, textured translucent black surface and 12px blur. Reference entrance scales from 90% and fades over 350ms with cubic-bezier(.22,1,.36,1). Moving between sections changes the content and panel size. Menus open on pointer hover or click and support keyboard access. Tezu uses its existing shorter menu content and artwork, so its dropdown dimensions follow that content.

Below 768px: 76px bar with the logo and a 44px menu control. Opening reveals a black full-height menu. The CTA and login appear above the destination rows. Rows are 56px tall, separated by subtle rules, with arrows into submenus. A submenu replaces the main list and shows a back button; long content scrolls inside the menu. Closing, selecting a link, or widening to desktop restores ordinary page scrolling.

Source screenshots and computed measurements are in `/tmp/resend-navbar-research/`; local and live verification screenshots are in the `tezu-resend-navbar-20261026` artifact directory.

## Adaptation

The existing reusable Arc header remains available with its default appearance. Resend-specific styling and mobile behavior are opt-in. The Tezu variation uses its existing product descriptions and artwork where appropriate; it does not reproduce Resend's email-product labels, imagery or Inter typeface. All app and integration destinations retain their previous behavior. Reduced-motion preferences disable entrance and transition motion. No backend services are added.

## Verification

`npm run check` passes with `NEXT_PUBLIC_BASE_PATH=/tezu-homepage` and static export enabled. Chromium checks pass at desktop widths 1440, 1920, 1024, 900 and 768px, and mobile widths 390, 320 and 767px. Hover menus, keyboard entry, Escape focus restoration, mobile back navigation, Claude integration selection, body scroll-lock cleanup after close/resize, reduced motion, retained galleries, and absence of horizontal overflow or page errors are verified.
