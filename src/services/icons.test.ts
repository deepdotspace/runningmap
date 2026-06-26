import { describe, expect, it } from 'vitest'
import { rankIcons } from './icons'

describe('rankIcons', () => {
  it('drops emoji / colored icon sets', () => {
    const out = rankIcons(['twemoji:dog', 'noto:dog', 'openmoji:dog', 'mdi:dog'])
    expect(out.map((i) => i.id)).toEqual(['mdi:dog'])
  })

  it('ranks solid silhouettes ahead of line/outline variants', () => {
    const out = rankIcons([
      'ph:dog-thin',
      'ph:dog-fill',
      'tabler:dog', // line set, no solid hint
      'mdi:dog', // solid-default prefix
    ])
    const ids = out.map((i) => i.id)
    // The two solid-ish ones should come before the line ones.
    expect(ids.indexOf('ph:dog-fill')).toBeLessThan(ids.indexOf('ph:dog-thin'))
    expect(ids.indexOf('mdi:dog')).toBeLessThan(ids.indexOf('ph:dog-thin'))
  })

  it('parses ids and builds a thumbnail URL', () => {
    const [first] = rankIcons(['mdi:dog'])
    expect(first.prefix).toBe('mdi')
    expect(first.name).toBe('dog')
    expect(first.svgUrl).toContain('/mdi/dog.svg')
  })

  it('respects the limit and skips malformed ids', () => {
    const out = rankIcons(['mdi:dog', 'notvalid', ':bad', 'bxs:cat'], 1)
    expect(out).toHaveLength(1)
  })

  it('demotes line-default sets below solid-default sets', () => {
    const ids = rankIcons(['tabler:dog', 'mdi:dog']).map((i) => i.id)
    expect(ids.indexOf('mdi:dog')).toBeLessThan(ids.indexOf('tabler:dog'))
  })
})
