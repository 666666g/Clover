export const LUMINOUS_STAGE_DESIGN_MD = `---
name: Luminous Stage
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c5c6ca'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8f9194'
  outline-variant: '#44474a'
  surface-tint: '#c4c7ca'
  primary: '#ffffff'
  on-primary: '#2d3134'
  primary-container: '#e0e2e6'
  on-primary-container: '#626568'
  inverse-primary: '#5c5f62'
  secondary: '#e9c349'
  on-secondary: '#3c2f00'
  secondary-container: '#af8d11'
  on-secondary-container: '#342800'
  tertiary: '#ffffff'
  on-tertiary: '#520070'
  tertiary-container: '#f9d8ff'
  on-tertiary-container: '#8f43ad'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e0e2e6'
  primary-fixed-dim: '#c4c7ca'
  on-primary-fixed: '#191c1f'
  on-primary-fixed-variant: '#44474a'
  secondary-fixed: '#ffe088'
  secondary-fixed-dim: '#e9c349'
  on-secondary-fixed: '#241a00'
  on-secondary-fixed-variant: '#574500'
  tertiary-fixed: '#f9d8ff'
  tertiary-fixed-dim: '#edb1ff'
  on-tertiary-fixed: '#320046'
  on-tertiary-fixed-variant: '#6e208c'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Sora
    fontSize: 64px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Sora
    fontSize: 40px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Sora
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Sora
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.08em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1280px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
---

## Brand & Style

The design system is engineered for a passionate and dedicated community, capturing the "idol" aesthetic through a lens of professional sophistication. It blends the crispness of high-fashion tailoring with the kinetic energy of a live stage performance.

The visual style is **Modern Minimalist with Glassmorphic accents**. It utilizes high-contrast monochrome foundations—reminiscent of a classic suit—interrupted by premium metallic and "passion" accents. The emotional response is one of exclusivity, energy, and unwavering support. Layouts are spacious and cinematic, allowing imagery to take center stage, supported by sharp, rhythmic UI elements that evoke a sense of precision and "superstar" quality.

## Colors

The palette is rooted in the "Classic Suit" aesthetic: **Deep Black** (#0A0A0A) serves as the primary canvas, providing a high-end, late-night stage atmosphere. **Metallic Grey/White** (#E5E7EB) is used for primary text and structural lines to maintain a crisp, modern feel.

**Passion Gold** (#D4AF37) and **Electric Purple** (#9D50BB) act as functional and emotional accents. Gold is reserved for "Star" moments—achievements, premium status, and primary calls to action. Purple is used for interactive states, gradients, and lighting effects that mimic stage visuals. Surfaces use subtle gradients to mimic the sheen of metallic fabrics.

## Typography

The typography system is bold and rhythmic. **Sora** provides a futuristic, geometric weight for headings, mimicking the impact of a stage backdrop. **Hanken Grotesk** offers a clean, contemporary feel for body copy, ensuring high readability during long-form engagement.

For technical data and meta-information, **Geist** provides a precise, developer-adjacent look that reinforces the "Professional" pillar of the brand. Headings should utilize tighter letter-spacing to create a "logo-like" appearance for titles. Large display text should occasionally use a subtle metallic gradient or "stroke-only" style to evoke neon stage signage.

## Layout & Spacing

The layout follows a **Fluid Grid** model with generous safe areas. A 12-column system is used for desktop, shifting to 4 columns for mobile.

Spacing is rhythmic and intentional, based on an 8px base unit. To reflect the "Stage Lighting" concept, negative space (the "darkness" of the stage) is treated as a first-class citizen. Content blocks are separated by significant vertical margins (64px+) to create a sense of scale and importance. Mobile layouts prioritize vertical scrolling with "edge-to-edge" cards that utilize 16px side margins to maximize visual impact.

## Elevation & Depth

Depth is achieved through **Glassmorphism and Lighting**, rather than traditional drop shadows.

1. **Base Layer:** Solid #050505.
2. **Mid Layer (Cards):** Semi-transparent surfaces (white at 5-8% opacity) with a 20px backdrop blur and a 1px "silk" border (white at 15% opacity).
3. **Top Layer (Modals/Popovers):** Higher opacity glass with a subtle outer glow in "Passion Gold" or "Electric Purple" to simulate stage spotlights hitting the surface.

Avoid heavy, muddy shadows. Use "inner glows" to give elements a self-illuminated, tech-forward quality.

## Shapes

The shape language is "Medium-Rounded," balancing the sharpness of professional attire with the approachability of a fan community.

- **Primary Components:** 0.5rem (8px) radius for buttons and input fields.
- **Large Containers:** 1rem (16px) for cards and sections.
- **Decorative Elements:** Use a "basketball-dimple" texture pattern as a subtle mask on background elements or large icon containers to provide tactile variety.
- **Interactive States:** Use "squircle" shapes for profile pictures and featured thumbnails to maintain a premium, custom-feel.

## Components

- **Buttons:** Primary buttons use a solid Gold-to-Purple horizontal gradient with white text. Secondary buttons are "Ghost" style with a 1px metallic border and high-blur backdrop.
- **Cards:** Glassmorphic containers with no fill, only a 1px top-left highlight border. Content within cards should use the "Sora" font for titles.
- **Chips/Tags:** Small, pill-shaped elements with 10% Gold opacity backgrounds and solid Gold text, used for categories like "Trending" or "Live."
- **Inputs:** Darker than the background (#000000) with a bottom-only border that glows Purple when focused.
- **Progress Bars:** Thin, high-contrast lines. The "active" portion should have a "scanning" light effect moving across it.
- **Stage Lights:** A unique decorative component consisting of soft, colored radial gradients positioned in the corners of the viewport to simulate off-screen spotlighting.
`

export const OFFICIAL_STYLE_DESIGN_MD = `---
name: Example Product
colors:
  primary: '#6750a4'
  on-primary: '#ffffff'
  surface: '#fffbfe'
typography:
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
rounded:
  md: 12px
spacing:
  md: 16px
---
# Brand & Style

Use a calm, accessible product language.
`

export const INVALID_DESIGN_MD = `---\nname: Invalid\ncolors:\n  primary: '{colors.missing}'\n---\n# Colors\n`
export const UNSAFE_DESIGN_MD = `---\nname: Unsafe\ncolors:\n  primary: 'url(javascript:alert(1))'\n---\n# Colors\n`
