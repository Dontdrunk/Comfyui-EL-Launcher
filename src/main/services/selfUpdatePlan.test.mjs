import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isNewer, parseLatestYml, pickFile, sha512Base64 } from './selfUpdatePlan.mjs'

const YML = `
version: 0.2.0
files:
  - url: ExplorerLauncher-0.2.0-setup.exe
    sha512: abcdef==
    size: 10
  - url: ExplorerLauncher-0.2.0-portable.exe
    sha512: xyz==
    size: 20
path: ExplorerLauncher-0.2.0-setup.exe
sha512: abcdef==
`

test('远端更高才算可更新', () => {
  assert.equal(isNewer('0.1.0', '0.2.0'), true)
  assert.equal(isNewer('v0.1.0', '0.2.0'), true)
  assert.equal(isNewer('0.2.0', '0.1.0'), false)
  assert.equal(isNewer('0.1.0', '0.1.0'), false)
  assert.equal(isNewer('0.1.0', 'latest'), false)
})

test('安装版和便携版选对文件名', () => {
  const parsed = parseLatestYml(YML)
  assert.ok(parsed)
  assert.equal(pickFile(parsed.files, false)?.url, 'ExplorerLauncher-0.2.0-setup.exe')
  assert.equal(pickFile(parsed.files, true)?.url, 'ExplorerLauncher-0.2.0-portable.exe')
})

test('sha512 字符串对得上', () => {
  const parsed = parseLatestYml(YML)
  assert.equal(parsed?.files[0]?.sha512, 'abcdef==')
  assert.equal(parsed?.files[1]?.sha512, 'xyz==')
  assert.equal(
    sha512Base64(Buffer.from('explorer')),
    '1MoaINlTKMILP/18uWqON8f4iaHfAUJihSS4cINp+rQVql984Y+XOeQe3V9S12GiFzoc5gnsZZDvLn299Ar8DQ=='
  )
})
