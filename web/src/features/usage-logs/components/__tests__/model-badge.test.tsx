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
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'
import type React from 'react'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'matchMedia',
] as const

if (!domWindow.customElements) {
  Object.defineProperty(domWindow, 'customElements', {
    configurable: true,
    value: {
      get: () => undefined,
      define: () => undefined,
      whenDefined: () => Promise.resolve(),
      upgrade: () => undefined,
    },
  })
}
const customElementsGlobal = domWindow.customElements as unknown

// Silent, structured-clone-compatible fallback in case happy-dom lacks it.
// The `@pierre/diffs` transitive import guards with typeof checks, so this
// only needs to exist to avoid a ReferenceError.
if (typeof globalThis.customElements === 'undefined') {
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: customElementsGlobal,
  })
}

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {},
    },
  },
})

const { ModelBadge } = await import('../model-badge')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type RenderedBadge = {
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

async function renderBadge(
  props: React.ComponentProps<typeof ModelBadge>
): Promise<RenderedBadge> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <ModelBadge {...props} />
      </I18nextProvider>
    )
  })

  return { container, root }
}

async function unmountBadge(rendered: RenderedBadge) {
  await act(async () => rendered.root.unmount())
  rendered.container.remove()
}

function normalizedText(value: string | null): string {
  return (value ?? '').replaceAll(/\s/g, '')
}

describe('model badge', () => {
  after(() => {
    domWindow.close()
  })

  test('renders the requested model name in a status badge when not mapped', async () => {
    const rendered = await renderBadge({ modelName: 'gpt-4o' })

    const text = normalizedText(rendered.container.textContent)
    assert.equal(text.includes('gpt-4o'), true)
    assert.equal(
      rendered.container.querySelectorAll('[data-actual-model="true"]').length,
      0
    )

    await unmountBadge(rendered)
  })

  test('shows the actual mapped model directly below the requested model', async () => {
    const rendered = await renderBadge({
      modelName: 'gpt-4o',
      actualModel: 'gpt-4o-2024-11-20',
    })

    const text = normalizedText(rendered.container.textContent)
    assert.equal(text.includes('gpt-4o'), true)
    assert.equal(text.includes('gpt-4o-2024-11-20'), true)

    const actualLine = rendered.container.querySelector(
      '[data-actual-model="true"]'
    )
    assert.ok(actualLine)
    assert.equal(normalizedText(actualLine?.textContent), 'gpt-4o-2024-11-20')

    await unmountBadge(rendered)
  })

  test('renders mapping when requested and actual models are identical', async () => {
    const rendered = await renderBadge({
      modelName: 'deepseek-chat',
      actualModel: 'deepseek-chat',
    })

    assert.ok(
      rendered.container.querySelector('[data-actual-model="true"]')
    )

    await unmountBadge(rendered)
  })

  test('keeps the provider icon visible alongside the actual model', async () => {
    const rendered = await renderBadge({
      modelName: 'claude-3-5-sonnet-20241022',
      actualModel: 'claude-3-5-sonnet-20241022',
    })

    const text = normalizedText(rendered.container.textContent)
    assert.equal(text.includes('claude-3-5-sonnet-20241022'), true)
    assert.ok(
      rendered.container.querySelector('[data-actual-model="true"]')
    )

    await unmountBadge(rendered)
  })
})