---
name: Synthetic Motion
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#ddb7ff'
  on-secondary: '#490080'
  secondary-container: '#6f00be'
  on-secondary-container: '#d6a9ff'
  tertiary: '#ffb783'
  on-tertiary: '#4f2500'
  tertiary-container: '#d97721'
  on-tertiary-container: '#452000'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#f0dbff'
  secondary-fixed-dim: '#ddb7ff'
  on-secondary-fixed: '#2c0051'
  on-secondary-fixed-variant: '#6900b3'
  tertiary-fixed: '#ffdcc5'
  tertiary-fixed-dim: '#ffb783'
  on-tertiary-fixed: '#301400'
  on-tertiary-fixed-variant: '#703700'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  title-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: -0.01em
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.0'
    letterSpacing: 0.08em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-margin: 24px
  gutter: 16px
  section-gap: 48px
  touch-target: 44px
---

## Brand & Style

This design system is built for a high-performance AI video generation platform. The aesthetic is rooted in **Modern Minimalism** with a **High-Tech** edge. The interface prioritizes focus on the generated media content by using a deep, atmospheric dark theme that avoids the harshness of pure black in favor of sophisticated charcoal and slate tones.

The emotional response should be one of "effortless power"—professional, streamlined, and highly responsive. Visual interest is generated through subtle glassmorphism and vibrant electric accents rather than heavy decorative elements. The design language emphasizes precision, utilizing generous whitespace (negative space) and technical typography to reflect the advanced nature of the underlying AI technology.

## Colors

The palette is anchored in a multi-layered dark environment. 
- **Base Background:** A deep charcoal (`#0B0E14`) provides a low-fatigue foundation.
- **Surface Tiers:** Use Slate Grays for elevated containers to create a sense of physical depth without traditional shadows.
- **Electric Accents:** The Primary Indigo (`#6366F1`) and Violet (`#A855F7`) are used sparingly for calls to action, progress indicators, and active states. 
- **Glassmorphism:** Overlays use a semi-transparent slate with a background blur (20px-32px) to maintain context while focusing the user's attention.

## Typography

This design system utilizes **Geist** for its technical precision and clean, monolinear construction. To achieve a premium feel:
- **Tracking:** Headlines feature tighter tracking (`-0.02em` to `-0.04em`) to feel "locked-in," while labels and small body text use generous tracking (`0.08em`) for maximum legibility against dark backgrounds.
- **Hierarchy:** Use font weight to differentiate between interactive labels and static content.
- **Scale:** Large display type should be used for impact during the video generation "success" states, while utility areas (sidebar/settings) remain compact and highly legible.

## Layout & Spacing

The layout follows a **Fluid Grid** model with strict adherence to a 4px baseline shift. 
- **Desktop:** A 12-column grid with 24px margins and 16px gutters. Panels (Properties/Timeline) should be collapsible to maximize the video preview area.
- **Mobile:** Transition to a single-column stacked layout with 16px horizontal margins.
- **Rhythm:** Use "Generous Padding" inside cards and containers (typically 24px or 32px) to prevent the technical density of the app from feeling overwhelming.

## Elevation & Depth

Depth is communicated through **Tonal Layering** and **Glassmorphism** rather than traditional heavy drop shadows.
- **Level 0 (Base):** Deepest charcoal background.
- **Level 1 (Cards/Sidebar):** Slightly lighter slate with a 1px subtle border (`rgba(255,255,255,0.08)`).
- **Level 2 (Modals/Popovers):** Glassmorphic surfaces with `backdrop-filter: blur(24px)` and a subtle "inner glow" border to simulate a light source from above.
- **Shadows:** Use only one type of shadow—a wide, highly diffused "Ambient Glow" for primary buttons and active video thumbnails, using the primary color at 15-20% opacity.

## Shapes

The shape language is **Modern and Friendly**, using a 12px default radius for most components.
- **Standard UI (Inputs, Buttons):** 12px (`rounded-md`).
- **Containers (Cards, Video Previews):** 16px (`rounded-lg`).
- **Interactive Feedback:** On hover, certain elements may subtly increase their corner radius or use a "shrink" transform effect to indicate clickability.

## Components

- **Buttons:** Primary buttons use the Electric Indigo gradient. On hover, apply a `brightness(1.1)` and a subtle outer glow. On "Pressed," use a `scale(0.96)` transform.
- **Glass Cards:** Used for floating toolbars. Must include a background blur and a 1px stroke.
- **Inputs:** Darker than the surface level (`#0F1115`) with a 1px border that illuminates to the primary color on focus.
- **Progress Bars:** Use a dual-tone gradient (Primary to Secondary) with a "pulsing" animation for AI processing states.
- **Video Thumbnails:** On hover, show a subtle play icon overlay and scale the image by 2% to create a tactile feeling of depth.
- **Chips:** Small, low-contrast pills for tags or metadata, using the `label-sm` typography style.