import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// api에는 실제 함수만 둔다. 테스트/유틸이 다시 배포 함수가 되는 것을 방지한다.
const expectedEndpoints = [
  'kakao/seoul-bus-evidence.ts',
  'kakao/subway-entrances.ts',
  'kakao/transit-routes.ts',
  'kakao/walking-route.ts',
  'subway/arrival.ts',
  'tago/bus-arrival.ts',
].sort()
const projectRoot = process.cwd()
const apiRoot = resolve(projectRoot, 'api')
const files = readdirSync(apiRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:[cm]?[jt]s|tsx)$/.test(entry.name))
  .map((entry) => relative(apiRoot, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  .sort()
assert.deepEqual(files, expectedEndpoints, '배포 API 파일 목록이 달라졌습니다. 사용 경로와 함수 수를 확인하세요.')
assert.ok(files.length <= 12, 'Hobby 함수 제한 초과')

const configPath = resolve(projectRoot, 'tsconfig.api.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
const cacheRoot = resolve(projectRoot, '.vercel')
mkdirSync(cacheRoot, { recursive: true })
const outputDir = mkdtempSync(join(cacheRoot, 'server-check-'))
try {
  const parsed = ts.parseJsonConfigFileContent({
    ...config.config,
    include: ['api/**/*.ts', 'server/**/*.ts'],
    exclude: ['**/*.test.ts'],
  }, ts.sys, projectRoot, {
    noEmit: false,
    incremental: false,
    rootDir: projectRoot,
    outDir: outputDir,
  })
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  if (diagnostics.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => projectRoot,
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    }))
  }
  assert.equal(program.emit().emitSkipped, false)
  writeFileSync(join(outputDir, 'package.json'), JSON.stringify({ type: 'module' }))
  // 외부 API/인증 요청 없이 실제 Node ESM import와 메서드 가드까지만 검증한다.
  process.env.VERCEL_ENV = 'production'
  process.env.VERCEL = '1'
  for (const endpoint of files) {
    const { default: handler } = await import(pathToFileURL(
      join(outputDir, 'api', endpoint.replace(/\.ts$/, '.js')),
    ).href)
    const response = { statusCode: 0, setHeader() {}, end() {} }
    await handler({ method: 'OPTIONS', headers: {} }, response)
    assert.equal(response.statusCode, 405, endpoint)
  }
  console.log(`Server check passed: ${files.length}/12 functions; strict NodeNext emit + Node ESM load + method guards`)
} finally {
  // mkdtemp로 만든 이 검사의 출력 디렉터리만 정리한다.
  assert.equal(resolve(outputDir, '..'), cacheRoot)
  rmSync(outputDir, { recursive: true, force: true })
}
