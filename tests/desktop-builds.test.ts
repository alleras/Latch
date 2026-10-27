import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
// Exercise the installed build tools, including target resolution after CLI parsing.
const { load } = require('js-yaml')
const { configureBuildCommand, createYargs, normalizeOptions } = require('electron-builder/out/builder.js')
const { computeArchToTargetNamesMap } = require('app-builder-lib/out/targets/targetFactory.js')
const { Platform } = require('app-builder-lib')
const { Arch } = require('builder-util')
const config = load(readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8'))
const workflow = load(readFileSync(new URL('../.github/workflows/desktop-builds.yml', import.meta.url), 'utf8'))
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function windowsTargets(scriptName: string): [string, string[]][] {
  const command = scripts[scriptName].split(' && ').find((part: string) => part.startsWith('electron-builder '))
  assert.ok(command, `${scriptName} must invoke electron-builder`)
  const args = configureBuildCommand(createYargs()).parse(command.split(/\s+/).slice(1))
  const raw = normalizeOptions(args).targets.get(Platform.WINDOWS)
  assert.ok(raw, 'command must build Windows targets')
  const resolved = computeArchToTargetNamesMap(raw, { platformSpecificBuildOptions: config.win }, Platform.WINDOWS)
  return Array.from(resolved, ([arch, targets]: [number, string[]]) => [Arch[arch], targets])
}

for (const arch of ['x64', 'arm64']) {
  test(`Windows ${arch} workflow job resolves only ${arch} NSIS and ZIP targets`, () => {
    const job = workflow.jobs.package.strategy.matrix.include.find((entry: { platform: string }) => entry.platform === `windows-${arch}`)
    assert.ok(job)
    const match = /^npm run (\S+)$/.exec(job.command)
    assert.ok(match, 'workflow must invoke a named packaging command')
    assert.deepEqual(windowsTargets(match[1]), [[arch, ['nsis', 'zip']]])
  })
}

test('default Windows packaging still builds separate x64 and ARM64 installers', () => {
  assert.deepEqual(windowsTargets('package:win').sort(), [
    ['arm64', ['nsis', 'zip']],
    ['x64', ['nsis', 'zip']]
  ])
  assert.equal(config.nsis.buildUniversalInstaller, false)
  assert.ok(config.win.artifactName.includes('${arch}'))
})

const releaseStep = workflow.jobs.release.steps.find((step: { run?: string }) => step.run?.includes('gh release create'))
assert.ok(releaseStep, 'workflow must have a release publishing step')
const releaseTestOptions = { skip: process.platform === 'win32' ? 'Release publishing runs on Ubuntu Bash' : false }

function runRelease(files: string[], check: (result: ReturnType<typeof spawnSync>, args: string[] | null) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'latch-release-test-'))
  try {
    mkdirSync(join(directory, 'artifacts'))
    mkdirSync(join(directory, 'bin'))
    for (const file of files) {
      const path = join(directory, 'artifacts', file)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, 'installer fixture')
    }
    // Record the publishing command without accessing GitHub.
    writeFileSync(join(directory, 'bin', 'gh'), '#!/bin/bash\nprintf \'%s\\n\' "$@" > "$RELEASE_TEST_ARGS"\n', { mode: 0o755 })
    const argsFile = join(directory, 'args')
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', releaseStep.run], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
        GITHUB_REF_NAME: 'v0.1.2',
        RELEASE_TEST_ARGS: argsFile
      }
    })
    let args: string[] | null = null
    try {
      args = readFileSync(argsFile, 'utf8').trimEnd().split('\n')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    check(result, args)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('release publishing rejects duplicate filenames across downloaded artifacts before invoking gh', releaseTestOptions, () => {
  runRelease(['windows-x64/Latch-windows-x64.exe', 'windows-arm64/Latch-windows-x64.exe'], (result, args) => {
    assert.equal(result.status, 1)
    assert.match(String(result.stdout), /Duplicate release asset filenames/)
    assert.match(String(result.stdout), /Latch-windows-x64\.exe/)
    assert.equal(args, null)
  })
})

test('release publishing rejects an empty artifact collection before invoking gh', releaseTestOptions, () => {
  runRelease([], (result, args) => {
    assert.equal(result.status, 1)
    assert.match(String(result.stdout), /No release assets found/)
    assert.equal(args, null)
  })
})

test('release publishing passes every unique asset to gh, preserving paths with spaces', releaseTestOptions, () => {
  const files = ['windows-x64/Latch windows x64.exe', 'windows-arm64/Latch-windows-arm64.exe', 'mac/Latch-mac-arm64.dmg']
  runRelease(files, (result, args) => {
    assert.equal(result.status, 0, String(result.stderr))
    assert.ok(args)
    assert.deepEqual(args.slice(0, 3), ['release', 'create', 'v0.1.2'])
    assert.deepEqual(args.slice(3, 3 + files.length).sort(), files.map((file) => `artifacts/${file}`).sort())
    assert.deepEqual(args.slice(3 + files.length), ['--generate-notes', '--title', 'Latch v0.1.2'])
  })
})
