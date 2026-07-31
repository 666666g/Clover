import type { CanvasShape } from './canvas-types'

export type CornerRadii = [number, number, number, number]

/** CSS-compatible radius normalization for [top-left, top-right, bottom-right, bottom-left]. */
export function normalizedCornerRadii(
  cornerRadius: CanvasShape['cornerRadius'],
  width: number,
  height: number
): CornerRadii {
  const raw: CornerRadii = typeof cornerRadius === 'number'
    ? [cornerRadius, cornerRadius, cornerRadius, cornerRadius]
    : [...cornerRadius]
  const radii = raw.map((value) => Math.max(0, Number.isFinite(value) ? value : 0)) as CornerRadii
  const safeWidth = Math.max(0, width)
  const safeHeight = Math.max(0, height)
  const ratios = [
    radii[0] + radii[1] > 0 ? safeWidth / (radii[0] + radii[1]) : 1,
    radii[3] + radii[2] > 0 ? safeWidth / (radii[3] + radii[2]) : 1,
    radii[0] + radii[3] > 0 ? safeHeight / (radii[0] + radii[3]) : 1,
    radii[1] + radii[2] > 0 ? safeHeight / (radii[1] + radii[2]) : 1
  ]
  const scale = Math.min(1, ...ratios)
  return radii.map((value) => value * scale) as CornerRadii
}

export function roundedRectPath(
  width: number,
  height: number,
  cornerRadius: CanvasShape['cornerRadius']
): string {
  const [tl, tr, br, bl] = normalizedCornerRadii(cornerRadius, width, height)
  return [
    `M ${tl} 0`,
    `H ${width - tr}`,
    tr > 0 ? `Q ${width} 0 ${width} ${tr}` : `L ${width} 0`,
    `V ${height - br}`,
    br > 0 ? `Q ${width} ${height} ${width - br} ${height}` : `L ${width} ${height}`,
    `H ${bl}`,
    bl > 0 ? `Q 0 ${height} 0 ${height - bl}` : `L 0 ${height}`,
    `V ${tl}`,
    tl > 0 ? `Q 0 0 ${tl} 0` : 'L 0 0',
    'Z'
  ].join(' ')
}
