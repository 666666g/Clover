import { memo } from 'react'
import type { CanvasShape } from '../../../../design/canvas/canvas-types'
import { roundedRectPath } from '../../../../design/canvas/canvas-rounded-rect'
import { ShapePaintDefs, primaryFillPaint, strokeDasharray } from './shape-paint'

function RectShapeInner({ shape }: { shape: CanvasShape }) {
  const { fill, fillOpacity } = primaryFillPaint(shape)
  const d = roundedRectPath(shape.width, shape.height, shape.cornerRadius)

  return (
    <>
      <ShapePaintDefs shape={shape} />
      <path d={d} fill={fill} fillOpacity={fillOpacity} />
      {shape.strokes.map((s, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width}
          strokeOpacity={s.opacity}
          strokeDasharray={strokeDasharray(s.dash, s.width)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  )
}

export const RectShape = memo(RectShapeInner)
