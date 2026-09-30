/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

export type ModelMappingPair = {
  /** Request model name that users call. */
  from: string
  /** Upstream model name sent to the provider. */
  to: string
}

/** Which side of the mapping the selected model names belong to. */
export type ModelMappingDirection = 'upstream' | 'request'

/**
 * A naming rule applied to the selected names to derive the other side of the
 * mapping. `strip-*` rules accept several comma-separated affixes and remove
 * the first one that matches. The backend matches mapping keys exactly, so
 * rules are expanded on the client into explicit pairs before saving.
 */
export type ModelMappingRule =
  | { type: 'strip-prefix'; values: string }
  | { type: 'strip-suffix'; values: string }
  | { type: 'add-prefix'; value: string }
  | { type: 'add-suffix'; value: string }
  | { type: 'replace'; find: string; replaceWith: string }

export type ModelMappingDerivation = {
  pairs: ModelMappingPair[]
  /** Selected models the rule left unchanged; they produce no mapping. */
  unchanged: string[]
  /** Selected models whose request name is already taken by an earlier pair. */
  conflicts: string[]
}

export function deriveModelMappingPairs(
  models: readonly string[],
  direction: ModelMappingDirection,
  rule: ModelMappingRule
): ModelMappingDerivation {
  const seen = new Set<string>()
  const requestNames = new Set<string>()
  const result: ModelMappingDerivation = {
    pairs: [],
    unchanged: [],
    conflicts: [],
  }
  const affixes =
    'values' in rule
      ? rule.values
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : []
  for (const raw of models) {
    const model = raw.trim()
    if (!model || seen.has(model)) continue
    seen.add(model)
    let derived = model
    if (rule.type === 'strip-prefix') {
      const prefix = affixes.find((affix) => model.startsWith(affix))
      if (prefix) derived = model.slice(prefix.length)
    } else if (rule.type === 'strip-suffix') {
      const suffix = affixes.find((affix) => model.endsWith(affix))
      if (suffix) derived = model.slice(0, -suffix.length)
    } else if (rule.type === 'add-prefix') {
      derived = `${rule.value}${model}`
    } else if (rule.type === 'add-suffix') {
      derived = `${model}${rule.value}`
    } else if (rule.find) {
      derived = model.replaceAll(rule.find, rule.replaceWith)
    }
    derived = derived.trim()
    if (!derived || derived === model) {
      result.unchanged.push(model)
      continue
    }
    const pair =
      direction === 'upstream'
        ? { from: derived, to: model }
        : { from: model, to: derived }
    if (requestNames.has(pair.from)) {
      result.conflicts.push(model)
      continue
    }
    requestNames.add(pair.from)
    result.pairs.push(pair)
  }
  return result
}

/**
 * Minimal task-plugin shape needed to decide whether a channel can claim a
 * model name. `modelPassthrough` marks plugins that claim undeclared names
 * through the channel's `model_mapping`.
 */
export type PassthroughModelOwner = {
  key: string
  models: readonly string[]
  modelPassthrough?: boolean
}

/**
 * Finds mapping source names that this channel can never claim because a
 * plugin it does not bind already declares them as a built-in model. The
 * backend routes such names straight to the declaring plugin, so the mapping
 * entry never receives traffic.
 *
 * Returns an empty list unless the channel binds a passthrough plugin: for
 * every other channel type `model_mapping` is an ordinary remap with no
 * competing claim. Names declared by a plugin the channel does bind are also
 * accepted, since those are served by this channel.
 */
export function findPluginOwnedMappingSources(
  sources: readonly string[],
  plugins: readonly PassthroughModelOwner[],
  boundPluginKeys: readonly string[]
): string[] {
  const bound = new Set(boundPluginKeys)
  const claimsPassthrough = plugins.some(
    (plugin) => plugin.modelPassthrough === true && bound.has(plugin.key)
  )
  if (!claimsPassthrough) return []

  const ownedByOthers = new Set<string>()
  for (const plugin of plugins) {
    if (bound.has(plugin.key)) continue
    for (const model of plugin.models) {
      const name = model.trim()
      if (name) ownedByOthers.add(name)
    }
  }

  const conflicts: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    const name = source.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    if (ownedByOthers.has(name)) conflicts.push(name)
  }
  return conflicts
}

/**
 * Merges pairs into a model-mapping JSON document. Existing request names keep
 * their position and receive the new upstream name; new pairs are appended.
 * Returns `null` when the current document is not a valid mapping object.
 */
export function mergeModelMappingPairs(
  current: string,
  pairs: readonly ModelMappingPair[]
): string | null {
  const mapping: Record<string, string> = {}
  const trimmed = current.trim()
  if (trimmed) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') return null
      mapping[key] = value
    }
  }
  for (const pair of pairs) {
    mapping[pair.from] = pair.to
  }
  if (Object.keys(mapping).length === 0) return ''
  return JSON.stringify(mapping, null, 2)
}
