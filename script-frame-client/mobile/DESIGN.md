---
name: Kinetix
colors:
  surface: '#121318'
  surface-dim: '#121318'
  surface-bright: '#38393f'
  surface-container-lowest: '#0d0e13'
  surface-container-low: '#1a1b21'
  surface-container: '#1e1f25'
  surface-container-high: '#292a2f'
  surface-container-highest: '#34343a'
  on-surface: '#e3e1e9'
  on-surface-variant: '#cbc3d7'
  inverse-surface: '#e3e1e9'
  inverse-on-surface: '#2f3036'
  outline: '#958ea0'
  outline-variant: '#494454'
  surface-tint: '#d0bcff'
  primary: '#d0bcff'
  on-primary: '#3c0091'
  primary-container: '#a078ff'
  on-primary-container: '#340080'
  inverse-primary: '#6d3bd7'
  secondary: '#4cd7f6'
  on-secondary: '#003640'
  secondary-container: '#03b5d3'
  on-secondary-container: '#00424e'
  tertiary: '#ffb95f'
  on-tertiary: '#472a00'
  tertiary-container: '#ca8100'
  on-tertiary-container: '#3e2400'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e9ddff'
  primary-fixed-dim: '#d0bcff'
  on-primary-fixed: '#23005c'
  on-primary-fixed-variant: '#5516be'
  secondary-fixed: '#acedff'
  secondary-fixed-dim: '#4cd7f6'
  on-secondary-fixed: '#001f26'
  on-secondary-fixed-variant: '#004e5c'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#121318'
  on-background: '#e3e1e9'
  surface-variant: '#34343a'
typography:
  headline-xl:
    fontFamily: Sora
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Sora
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Sora
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Sora
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Sora
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Sora
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: 0em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.04em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.08em
  label-xs:
    fontFamily: JetBrains Mono
    fontSize: 9px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.1em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-tablet: 1rem
  margin: 1rem
  margin-tablet: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

The design system establishes a high-precision, tactile digital workstation tailored for mobile cinematographers, AI video creators, and visual artists. The brand tone combines the discipline of high-end cinema hardware with the fluidity of generative synthetic media: technical, immersive, hyper-responsive, and effortlessly powerful.

The aesthetic fuses **Tactile Glassmorphism** with **Cyber-Optic HUD** elements:
- Deep obsidian backdrop layers anchor content and eliminate peripheral visual noise.
- Optical glass panels with subtle specular highlights reflect light like premium lens elements.
- Active states deploy controlled luminescence (cyan, violet, and amber halos) rather than diffuse or muddy glow effects, communicating live computational energy.
- Interface framing mimics anamorphic viewfinders, optical calibration rings, and modular director monitors.

## Colors

The palette operates on calibrated contrast ratios to preserve night-vision focus during production workflows while maintaining precise visual differentiation for nested controls.

- **Void Surfaces (Neutral Base):** Deep void obsidian (`#090A0F`) serves as the base canvas, paired with elevated structural containers (`#12141F`) and floating panel surfaces (`#1A1D2E`). Translucent glass fills operate at `rgba(18, 20, 31, 0.70)` with variable border edge highlights (`rgba(255, 255, 255, 0.08)` to `rgba(255, 255, 255, 0.16)`).
- **Electric Violet (Primary - Generation & Core Action):** `#8B5CF6` represents computational creation, model inference, and primary interaction targets (e.g., render triggers, prompt engines, active node badges).
- **Cyber Cyan (Secondary - Optical & Camera Telemetry):** `#06B6D4` drives viewport mechanics, aspect ratio grids, timeline playheads, and optical tracking telemetry.
- **Neon Amber (Tertiary - Parameter Modulation & Warnings):** `#F59E0B` designates frame rate thresholds, dynamic render weights, audio peaks, and destructive overrides.
- **Text & Contrast Tiers:** High-emphasis text (`#F8FAFC`), mid-emphasis telemetry (`#94A3B8`), and subdued metadata guides (`#475569`).

## Typography

The typography system uses a tri-font framework designed for rapid parsing on mobile screens under intense dynamic imagery:

- **Sora (Headlines & Title Frames):** Geometric, futuristic, and optically balanced. Used exclusively for primary panel headers, project titles, modal overlays, and feature introductions.
- **Plus Jakarta Sans (Body & Context):** Clean, warm, humanist sans-serif. Used for prompt composition fields, descriptions, user settings, and workflow guidelines where legibility during fast scrolling is vital.
- **JetBrains Mono (Technical & Metadata):** Monospaced precision. Encodes frame counts (`00:02:14:08`), seed codes, resolution ratios (`2.39:1`), CFG scale values, temperature meters, and active hardware constraints. All numeric data must be tabular to prevent layout jitter during scrub operations.

## Layout & Spacing

The layout is built around an ergonomic thumb-zone hierarchy designed for portrait capture and landscape monitoring workflows.

- **Mobile Viewport Grid:** Operates on a 4-column fluid structure with a default `1rem` (16px) margin and `0.75rem` (12px) gutter.
- **Bottom-Weighted Architecture:** Primary controls, timeline playback scrubbers, and prompt generation triggers are anchored within the lower 40% of the screen (thumb reach). Telemetry, viewport preview, and monitoring indicators populate the upper half.
- **Dynamic Docking:** Control panels slide down into minimized high-density pill monitors during active timeline playback, expanding to full glass sheets when pausing on specific keyframes.
- **Safe Zone Insets:** Full compliance with device display cutouts and interactive home indicators, utilizing `env(safe-area-inset-*)` padding seamlessly mapped into background canvas fills.

## Elevation & Depth

Visual depth is achieved through layered optical refraction and luminous perimeter boundaries rather than opaque drop shadows:

- **Surface Tier 0 (Canvas Void):** `#090A0F` base layer; absorbs non-interactive screen real estate.
- **Surface Tier 1 (Background Shelves & Docks):** `#12141F` with 0.85 opacity, receiving a `backdrop-filter: blur(20px)` and an interior top-edge specular stroke of `1px solid rgba(255, 255, 255, 0.06)`.
- **Surface Tier 2 (Floating Action Glass & Toolbars):** Background `#1A1D2E` at 0.65 opacity with `backdrop-filter: blur(28px) saturate(180%)`. Border: `1px solid rgba(255, 255, 255, 0.12)`.
- **Surface Tier 3 (Modals, Overlays & Keyframe Pickers):** Background `#22263D` at 0.80 opacity with `backdrop-filter: blur(40px)`. Outer edge: `1px solid rgba(139, 92, 246, 0.3)`.
- **Luminescence & Glow Profiles:** 
  - Standard interactive elevation incorporates zero diffuse dark shadow, replaced by an inner glow: `box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15)`.
  - Active/Focused engine state utilizes an optical bloom: `box-shadow: 0 0 20px -4px rgba(139, 92, 246, 0.45), 0 0 8px -2px rgba(6, 182, 212, 0.3)`.

## Shapes

The geometric framework balances functional high-density displays with organic ergonomics:

- **Containers & Surfaces:** Set to `0.5rem` (8px) for compact telemetry boxes and `1rem` (16px) for major modal viewports and inspector sheets.
- **Interactive Control Nodes:** Buttons, parameter chips, and dynamic navigation rails utilize extreme radiuses (full pill geometry) to convey quick touchability and continuous gesture tracking.
- **Viewfinder & Lens Masking:** Preview viewports feature precise internal corner cutouts and razor-thin framing guides to maintain authentic optical monitor aesthetics.

## Components

### Buttons
- **Primary Kinetic Action (Generate / Render):** Capsule/pill form factor. Gradient surface transitioning from `#8B5CF6` to `#7C3AED`, overlaid with an ultra-thin 1px top highlight (`rgba(255, 255, 255, 0.3)`). Active tap delivers haptic tick and micro-scale depression (`scale(0.97)`), accompanied by a Cyber Cyan halo pulse.
- **Secondary / Ghost:** Framed in `1px solid rgba(255, 255, 255, 0.12)`, background `rgba(255, 255, 255, 0.04)`. Monospaced text in `#94A3B8`, brightening to `#F8FAFC` on press.

### Sliders (Cinematic Scrubber & Parameter Dial)
- **Track:** 4px height, `#1E2235` background with etched frame-interval ticks.
- **Fill:** Gradient track (`#8B5CF6` to `#06B6D4`) denoting scrub progress or motion vector intensity.
- **Thumb:** Tactile optical disc (20px diameter) constructed of frosted glass, encased with a 2px Cyber Cyan ring and a center micro-aperture dot. Displays a floating JetBrains Mono value badge (`+1.42 EV`, `24.0 FPS`) directly above the thumb during touch-drag.

### Parameter Chips & Toggles
- **Default State:** Pill shape with `0.25rem` vertical and `0.75rem` horizontal padding. Surface `rgba(255, 255, 255, 0.05)`, text `#94A3B8`, border `1px solid rgba(255, 255, 255, 0.08)`.
- **Active / Engaged State:** Background shifts to `rgba(139, 92, 246, 0.18)`, border to `1px solid #8B5CF6`. Typography shifts to high-contrast white with an integrated Cyber Cyan LED dot indicator (4px) anchored to the left of the label.

### Input Fields (Prompt & Guidance Mechanics)
- Frosted trench container (`#0C0D14` background at 90% opacity, inset shadow `inset 0 2px 4px rgba(0, 0, 0, 0.6)`).
- Border: `1px solid rgba(255, 255, 255, 0.08)`, sharpening to an animated electric violet border on focus.
- Monospace auxiliary badges inside the input area indicate model token limits and negative prompt switches.

### Cards & Keyframe Canvases
- Multi-layer glass cards displaying generated frames. Ratio locks (16:9, 9:16, 2.39:1) framed by hairline alignment reticles in each corner.
- Status overlay features an auto-dimming JetBrains Mono metadata ribbon displaying model engine (`v3.5-Turbo`), seed number, and render latency.