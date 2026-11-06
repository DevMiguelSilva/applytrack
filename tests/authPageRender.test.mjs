import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const entry = fileURLToPath(new URL('../src/pages/AuthPage.tsx', import.meta.url))
const require = createRequire(import.meta.url)
const source = readFileSync(entry, 'utf8')

async function renderAuthPage(configured) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    plugins: [{
      name: 'mock-auth-page-dependencies',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^\.\.\/hooks\/useAuth$/ }, () => ({ path: 'use-auth', namespace: 'auth-test' }))
        buildApi.onResolve({ filter: /^\.\.\/lib\/supabase$/ }, () => ({ path: 'supabase', namespace: 'auth-test' }))
        buildApi.onResolve({ filter: /^\.\.\/components\/BoardLook$/ }, () => ({ path: 'board-look', namespace: 'auth-test' }))
        buildApi.onLoad({ filter: /.*/, namespace: 'auth-test' }, (args) => {
          if (args.path === 'use-auth') return { contents: 'export const useAuth = () => ({ signIn: async () => {}, signUp: async () => {} })', loader: 'js' }
          if (args.path === 'supabase') return { contents: `export const isSupabaseConfigured = ${configured}`, loader: 'js' }
          return { contents: `export const boardLook = { label: 'ui-label', body: 'ui-description', button: 'ui-button ui-primary', headline: 'ui-title' }`, loader: 'js' }
        })
      },
    }],
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
  return renderToStaticMarkup(createElement(module.exports.AuthPage))
}

test('configured auth render keeps account controls, accessible feedback, and responsive welcome layout', async () => {
  const html = await renderAuthPage(true)
  assert.match(html, /lg:grid-cols-\[1\.05fr_0\.95fr\]/)
  assert.match(html, /grid-cols-1/)
  assert.match(html, /aria-label="Account access"/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /name="email"[^>]*required/)
  assert.match(html, /name="password"[^>]*minLength="6"/)
  assert.match(source, /role="alert"/)
  assert.match(source, /role="status"/)
  assert.match(html, /Welcome back/)
  assert.doesNotMatch(html, /Continue to Board/)
})

test('local-only render explains local storage and retains Continue to Board', async () => {
  const html = await renderAuthPage(false)
  assert.match(html, /Your workspace is ready/)
  assert.match(html, /saved locally/)
  assert.match(html, /href="\/"[^>]*>Continue to Board/)
  assert.match(html, /lg:grid-cols-\[1\.05fr_0\.95fr\]/)
  assert.doesNotMatch(html, /Account access|name="email"/)
})
