import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createActivationGuard } from '../src/renderer/src/activation-guard.ts'

test('an ordinary activation may adopt', () => {
  const guard = createActivationGuard()
  assert.equal(guard.shouldAdopt('tab-a'), true)
})

test('a suppressed activation is consumed once and never adopts', () => {
  const guard = createActivationGuard()
  guard.suppress('tab-a')
  assert.equal(guard.shouldAdopt('tab-a'), false)
  assert.equal(guard.shouldAdopt('tab-a'), true)
})

test('activating a different tab clears a stale suppression', () => {
  const guard = createActivationGuard()
  guard.suppress('tab-a')
  assert.equal(guard.shouldAdopt('tab-b'), true)
  assert.equal(guard.shouldAdopt('tab-a'), true)
})

test('no active tab never adopts', () => {
  const guard = createActivationGuard()
  assert.equal(guard.shouldAdopt(null), false)
})
