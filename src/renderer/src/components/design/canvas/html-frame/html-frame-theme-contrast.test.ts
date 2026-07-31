import { describe, expect, it } from 'vitest'
import { qualityBadgeClasses, qualityFindingClasses } from './html-frame-helpers'

describe('HTML frame dark-theme contrast classes', () => {
  it.each(['critical', 'warning', 'passed', 'checking'] as const)(
    'provides an explicit dark surface and foreground for %s quality badges',
    (kind) => {
      const classes = qualityBadgeClasses(kind)
      expect(classes).toMatch(/dark:bg-/)
      expect(classes).toMatch(/dark:text-/)
      expect(classes).toMatch(/dark:border-/)
    }
  )

  it.each(['critical', 'warning', 'info'] as const)(
    'provides an explicit dark semantic treatment for %s findings',
    (severity) => {
      const classes = qualityFindingClasses(severity)
      expect(classes).toMatch(/dark:bg-/)
      expect(classes).toMatch(/dark:text-/)
      expect(classes).toMatch(/dark:border-/)
    }
  )
})
