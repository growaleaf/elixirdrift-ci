'use strict';
// Standalone-package test suite for elixirdrift-ci. Exercises the exact exported functions the
// shipped cli.js ships against real fixture trees on disk (.tool-versions, mix.exs, Dockerfile,
// .github/workflows/*.yml) — never a mocked file tree.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const {
  buildReport, verifyLicenseWith, parseVersionKey, parseElixirRequirement, keySatisfiesRange,
  findDockerfilePins, findWorkflowPins, readToolVersionsElixir, readMixExsElixir,
} = require('../cli.js');

let passed = 0;
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed++;
    console.log('  ok -', name);
  }).catch((err) => {
    failures.push({ name, err });
    console.log('FAIL -', name, '\n       ', err.message);
  });
}

const FIXTURES = path.join(__dirname, 'fixtures');

async function main() {
  await check('parseVersionKey extracts major.minor as a comparable integer, null when ambiguous', () => {
    assert.equal(parseVersionKey('1.17.3'), 117);
    assert.equal(parseVersionKey('1.14'), 114);
    assert.equal(parseVersionKey('elixir:1.17.3-otp-27-alpine'), 117);
    assert.equal(parseVersionKey('latest'), null);
    assert.equal(parseVersionKey('1'), null);
  });

  await check('parseElixirRequirement: "~> X.Y.Z" locks the MINOR level (exact pin on major.minor)', () => {
    assert.deepEqual(parseElixirRequirement('~> 1.15.0'), { min: null, max: null, exact: 115 });
  });

  await check('parseElixirRequirement: "~> X.Y" locks the MAJOR level (floor at X.Y, capped below next major)', () => {
    assert.deepEqual(parseElixirRequirement('~> 1.17'), { min: 117, max: 200, exact: null });
  });

  await check('parseElixirRequirement handles ==X.Y, a bare X.Y, and >=X.Y with an optional "and <X.Y"', () => {
    assert.deepEqual(parseElixirRequirement('== 1.16'), { min: null, max: null, exact: 116 });
    assert.deepEqual(parseElixirRequirement('1.16'), { min: null, max: null, exact: 116 });
    assert.deepEqual(parseElixirRequirement('>= 1.14'), { min: 114, max: null, exact: null });
    assert.deepEqual(parseElixirRequirement('>= 1.14 and < 1.17'), { min: 114, max: 117, exact: null });
    assert.equal(parseElixirRequirement(''), null);
  });

  await check('keySatisfiesRange: an exact requirement only matches that one key', () => {
    const range = parseElixirRequirement('~> 1.15.0');
    assert.equal(keySatisfiesRange(115, range), true);
    assert.equal(keySatisfiesRange(116, range), false);
    assert.equal(keySatisfiesRange(114, range), false);
  });

  await check('keySatisfiesRange: a floor+major-cap range excludes keys outside [min, max)', () => {
    const range = parseElixirRequirement('~> 1.17');
    assert.equal(keySatisfiesRange(117, range), true);
    assert.equal(keySatisfiesRange(199, range), true);
    assert.equal(keySatisfiesRange(200, range), false);
    assert.equal(keySatisfiesRange(116, range), false);
  });

  await check('readToolVersionsElixir reads the first version token on the "elixir" line, ignores comments and other tools', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elixirdrift-tv-'));
    fs.writeFileSync(path.join(dir, '.tool-versions'), 'erlang 27.1\nelixir 1.17.3 1.16.2 # fallback list\n');
    assert.deepEqual(readToolVersionsElixir(dir), { raw: '1.17.3', key: 117 });
    assert.equal(readToolVersionsElixir(os.tmpdir() + '/does-not-exist-elixirdrift'), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('readMixExsElixir reads the elixir: requirement from mix.exs, null when absent or missing field', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elixirdrift-mix-'));
    fs.writeFileSync(path.join(dir, 'mix.exs'), 'defmodule X.MixProject do\n  def project do\n    [app: :x, elixir: "~> 1.17"]\n  end\nend\n');
    assert.equal(readMixExsElixir(dir).raw, '~> 1.17');
    fs.writeFileSync(path.join(dir, 'mix.exs'), 'defmodule X.MixProject do\n  def project do\n    [app: :x]\n  end\nend\n');
    assert.equal(readMixExsElixir(dir), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('findDockerfilePins finds every "FROM elixir:X.Y" across any Dockerfile*, strips otp/variant suffixes, skips unversioned tags', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elixirdrift-docker-'));
    fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM elixir:1.14-otp-25-slim\nRUN echo hi\n');
    fs.mkdirSync(path.join(dir, 'services', 'api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'services', 'api', 'Dockerfile.prod'), 'FROM elixir:latest\nFROM elixir:1.17.3-otp-27-alpine\n');
    const pins = findDockerfilePins(dir);
    assert.equal(pins.length, 2); // the unversioned "elixir:latest" FROM is skipped
    assert.deepEqual(pins.map((p) => p.key).sort(), [114, 117]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('findWorkflowPins reads a scalar elixir-version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elixirdrift-wf-scalar-'));
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), [
      'jobs:', '  test:', '    steps:', '      - uses: erlef/setup-beam@v1',
      '        with:', "          elixir-version: '1.17.3'", '',
    ].join('\n'));
    const pins = findWorkflowPins(dir);
    assert.equal(pins.length, 1);
    assert.equal(pins[0].key, 117);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('findWorkflowPins treats a block-style matrix list as matrix, not a comparable pin', () => {
    const pins = findWorkflowPins(path.join(FIXTURES, 'matrix'));
    const matrixPins = pins.filter((p) => p.matrix);
    assert.equal(matrixPins.length, 1);
    assert.deepEqual(matrixPins[0].values, ['1.15', '1.16', '1.17']);
  });

  await check('buildReport free mode (no Pro): consistent fixture has zero findings', () => {
    const result = buildReport(path.join(FIXTURES, 'consistent'), { pro: false });
    assert.equal(result.breach, false);
    assert.equal(result.pro, false);
    // Dockerfile/CI pins are not even collected in free mode.
    assert.equal(result.sources.pins.length, 1);
  });

  await check('buildReport Pro mode: consistent fixture (.tool-versions=1.17.3, elixir ~> 1.17, Dockerfile 1.17.3-otp-27, CI 1.17.3) is clean', () => {
    const result = buildReport(path.join(FIXTURES, 'consistent'), { pro: true });
    assert.equal(result.breach, false);
    assert.equal(result.sources.pins.length, 3);
  });

  await check('buildReport Pro mode: drift fixture flags both pinMismatch and mixElixirMismatch', () => {
    const result = buildReport(path.join(FIXTURES, 'drift'), { pro: true });
    assert.equal(result.breach, true);
    assert.ok(result.findings.some((f) => f.rule === 'pinMismatch'));
    assert.ok(result.findings.some((f) => f.rule === 'mixElixirMismatch'));
  });

  await check('buildReport free mode on the drift fixture: the exact "~> X.Y.Z" requirement still catches .tool-versions alone', () => {
    const result = buildReport(path.join(FIXTURES, 'drift'), { pro: false });
    assert.equal(result.breach, true);
    assert.equal(result.findings.every((f) => f.rule === 'mixElixirMismatch'), true);
    assert.equal(result.sources.pins.length, 1); // .tool-versions only — no Dockerfile/CI pin collected
  });

  await check('buildReport Pro mode: a deliberate version matrix in CI is reported as skipped, never as drift', () => {
    const result = buildReport(path.join(FIXTURES, 'matrix'), { pro: true });
    assert.equal(result.breach, false);
    assert.equal(result.matrixSources.length, 1);
  });

  await check('buildReport on a tree with only .tool-versions (no mix.exs, no Docker, no CI) is clean, not an error', () => {
    const result = buildReport(path.join(FIXTURES, 'minimal'), { pro: true });
    assert.equal(result.breach, false);
    assert.equal(result.sources.mixElixir, null);
  });

  await check('buildReport throws ConfigError when --dir does not exist', () => {
    assert.throws(() => buildReport(path.join(FIXTURES, 'does-not-exist'), {}), /is not a directory/);
  });

  await check('CLI end-to-end via real subprocess: free mode runs with no key, Pro mode engages with a real minted key', () => {
    const cliPath = path.join(__dirname, '..', 'cli.js');

    const runCli = (args, env) => {
      try {
        const out = execFileSync('node', [cliPath, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
        return { code: 0, out };
      } catch (e) {
        return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
      }
    };

    // Free mode, no key at all: consistent fixture is still clean (exit 0), and the CLI runs
    // successfully rather than refusing outright — license absence narrows scope, it is not a
    // hard gate on the whole tool.
    const freeRun = runCli(['check', '--dir', path.join(FIXTURES, 'consistent')], { ELIXIRDRIFT_KEY: '' });
    assert.equal(freeRun.code, 0);
    assert.ok(freeRun.out.includes('free'));

    // Pro mode with a real minted key: the drift fixture now fails (Dockerfile pins 1.14
    // against a .tool-versions/CI of 1.17.3, which free mode alone could not see).
    const devVarsPath = path.join(os.homedir(), '.hive_devtools_license_keys', 'elixirdrift.dev.vars');
    const devVars = fs.readFileSync(devVarsPath, 'utf8');
    const privB64 = devVars.match(/LICENSE_PRIVATE_KEY=(\S+)/)[1];
    const privateKey = crypto.createPrivateKey({ key: Buffer.from(privB64, 'base64'), format: 'der', type: 'pkcs8' });
    const payload = Buffer.from(JSON.stringify({ product: 'elixirdrift-pro', iat: Date.now() })).toString('base64url');
    const sig = crypto.createSign('SHA256').update(`EX1.${payload}`).end().sign(privateKey).toString('base64url');
    const realKey = `EX1.${payload}.${sig}`;

    const proRun = runCli(['check', '--dir', path.join(FIXTURES, 'drift')], { ELIXIRDRIFT_KEY: realKey });
    assert.equal(proRun.code, 1);
    assert.ok(proRun.out.includes('Pro'));

    const proCleanRun = runCli(['check', '--dir', path.join(FIXTURES, 'consistent')], { ELIXIRDRIFT_KEY: realKey });
    assert.equal(proCleanRun.code, 0);
  });

  await check('license: a key signed by the real private key verifies true against the matching public key', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    const payload = Buffer.from(JSON.stringify({ product: 'elixirdrift-pro', iat: Date.now() })).toString('base64url');
    const sig = crypto.createSign('SHA256').update(`EX1.${payload}`).end().sign(privateKey).toString('base64url');
    assert.equal(verifyLicenseWith(`EX1.${payload}.${sig}`, pubPem), true);
  });

  await check('license: a tampered key is rejected', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    const payload = Buffer.from(JSON.stringify({ product: 'elixirdrift-pro', iat: Date.now() })).toString('base64url');
    const sig = crypto.createSign('SHA256').update(`EX1.${payload}`).end().sign(privateKey).toString('base64url');
    const tamperedPayload = Buffer.from(JSON.stringify({ product: 'elixirdrift-pro', iat: 0 })).toString('base64url');
    assert.equal(verifyLicenseWith(`EX1.${tamperedPayload}.${sig}`, pubPem), false);
  });

  await check('license: non-canonical base64url (coin-flip tamper-bypass shape) is rejected, not accepted by luck', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    const payload = Buffer.from(JSON.stringify({ product: 'elixirdrift-pro', iat: Date.now() })).toString('base64url');
    const sig = crypto.createSign('SHA256').update(`EX1.${payload}`).end().sign(privateKey).toString('base64url');
    assert.equal(verifyLicenseWith(`EX1.${payload}.${sig}AB`, pubPem), false);
  });

  await check('license: a key signed by a DIFFERENT private key is rejected by this public key', () => {
    const { publicKey: pubA } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const { privateKey: privB } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pubPemA = pubA.export({ type: 'spki', format: 'pem' });
    const payload = Buffer.from(JSON.stringify({ product: 'elixirdrift-pro', iat: Date.now() })).toString('base64url');
    const sig = crypto.createSign('SHA256').update(`EX1.${payload}`).end().sign(privB).toString('base64url');
    assert.equal(verifyLicenseWith(`EX1.${payload}.${sig}`, pubPemA), false);
  });

  await check('license: wrong product in the payload is rejected even with a valid signature', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    const payload = Buffer.from(JSON.stringify({ product: 'some-other-product', iat: Date.now() })).toString('base64url');
    const sig = crypto.createSign('SHA256').update(`EX1.${payload}`).end().sign(privateKey).toString('base64url');
    assert.equal(verifyLicenseWith(`EX1.${payload}.${sig}`, pubPem), false);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
  else console.log('All elixirdrift-ci standalone test groups passed.');
}

main();
