const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()
const equalSet = (left, right) => JSON.stringify([...left].map(normalize).sort()) === JSON.stringify([...right].map(normalize).sort())

/**
 * Link only semantically complete requirement groups. A shared component is
 * insufficient: all expected components and the ALL/ANY operator must match.
 */
export function compareRequirementGroups(expected, predicted) {
  const used = new Set()
  const links = new Map()
  for (const [expectedIndex, requirement] of expected.entries()) {
    const components = Array.isArray(requirement.components) && requirement.components.length
      ? requirement.components
      : [requirement.label]
    for (const [predictedIndex, candidate] of predicted.entries()) {
      if (used.has(predictedIndex)) continue
      const candidateComponents = Array.isArray(candidate.components) && candidate.components.length
        ? candidate.components
        : [candidate.label]
      if (requirement.logic !== candidate.logic || !equalSet(components, candidateComponents)) continue
      used.add(predictedIndex)
      links.set(expectedIndex, { predictedIndex })
      break
    }
  }
  return links
}

export function scoreRequirementExtraction(expected, predicted) {
  const links = compareRequirementGroups(expected, predicted)
  const criticalMisses = expected
    .filter((requirement, index) => requirement.critical && !links.has(index))
    .map(requirement => requirement.label)
  return {
    links,
    found: links.size,
    precision: predicted.length ? links.size / predicted.length : 0,
    recall: expected.length ? links.size / expected.length : 0,
    criticalMisses,
  }
}
