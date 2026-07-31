import { memo } from 'react'
import type { CanvasShape } from '../../../../design/canvas/canvas-types'
import { ShapePaintDefs, primaryFillPaint, strokeDasharray } from './shape-paint'

function EllipseShapeInner({ shape }: { shape: CanvasShape }) {
  const cx = shape.width / 2
  const cy = shape.height / 2
  const rx = shape.width / 2
  const ry = shape.height / 2
  const { fill, fillOpacity } = primaryFillPaint(shape)

  return (
    <>
      <ShapePaintDefs shape={shape} />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill} fillOpacity={fillOpacity} />
      {shape.strokes.map((s, i) => (
        <ellipse
          key={i}
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width}
          strokeOpacity={s.opacity}
          strokeDasharray={strokeDasharray(s.dash, s.width)}
          strokeLinecap="round"
        />
      ))}
    </>
  )
}

export const EllipseShape = memo(EllipseShapeInner)
