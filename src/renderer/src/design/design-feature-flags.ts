/**
 * Feature flags for the design workspace.
 *
 * Design mode now centers on the unified Figma-style board: HTML screen frames
 * and SVG motion frames are normal canvas frames linked to first-class file
 * artifacts. HTML and SVG each use their dedicated preview host on that board.
 *
 * `DESIGN_CANVAS_ENABLED` is kept only as a compatibility gate for older
 * sidebar/canvas entry points that still check it. It must not be used to bring
 * back the legacy standalone project preview surface.
 */
export const DESIGN_CANVAS_ENABLED: boolean = false
