#!/usr/bin/env node
'use strict';

// elixirdrift-ci — self-contained, dependency-free (Node 18+, no npm install).
// Checks whether the Elixir version your team THINKS the project targets agrees across every
// place a project can declare one: .tool-versions (asdf), mix.exs's "elixir:" requirement,
// any Dockerfile's "FROM elixir:X.Y", and any GitHub Actions workflow's "elixir-version:".
// Each of those is edited by a different person at a different time, so they drift silently —
// the same "works in CI, breaks in the Docker image" (or the reverse) bug this lane has already
// shipped for Node/Python/Go/Ruby/Java/Rust/Swift, ported to Elixir's own four files.
//
// FREE: compares .tool-versions against mix.exs's "elixir:" requirement only. No key needed.
// PRO: also scans every Dockerfile and GitHub Actions workflow in the repo and cross-checks
//      every source against every other source. Unlocked by a valid offline license key — no
//      network call, no account, no phone-home.
//
// Usage:
//   node cli.js check [--dir <path>] [--json]
//
// Exit codes:
//   0 - no drift found
//   1 - a drift finding exists (any rule)
//   2 - configuration/usage error (--dir does not exist or is not a directory)

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ---------------------------------------------------------------------------------------
// License (BP-001 offline ECDSA-P256 verify) — same chassis as every other D-lane standalone
// CLI, including the canonical-base64url round-trip check from the first line (the tamper-
// bypass coin-flip bug this lane found and fixed 2026-09-07, re-introduced once in
// localbolt-ci before being caught 2026-10-13, ported in from day one on every build since).
// ---------------------------------------------------------------------------------------
const PUBLIC_KEY_PEM = '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdEpMcuW3DlvidmmczeoRw1ynyWFf\nkTkgoaE0M287ZhEuLzGsNvtmuX6nDMDvNtr8+jnR4BQWPMF0kT9xCymWEA==\n-----END PUBLIC KEY-----';
const LICENSE_PRODUCT = 'elixirdrift-pro';

function b64urlToBuf(s) {
  const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const canonical = buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (canonical !== s) throw new Error('non-canonical base64url');
  return buf;
}

function verifyLicenseWith(key, pubPem) {
  try {
    if (typeof key !== 'string') return false;
    const parts = key.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'EX1') return false;
    const signedData = `EX1.${parts[1]}`;
    const payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8'));
    if (payload.product !== LICENSE_PRODUCT) return false;
    if (payload.exp && Date.now() > payload.exp) return false;
    const v = crypto.createVerify('SHA256');
    v.update(signedData); v.end();
    return v.verify(pubPem, b64urlToBuf(parts[2]));
  } catch (e) { return false; }
}

function verifyLicense(key) {
  if (PUBLIC_KEY_PEM.includes('PLACEHOLDER')) return false;
  return verifyLicenseWith(key, PUBLIC_KEY_PEM);
}

function readLicenseKey() {
  if (process.env.ELIXIRDRIFT_KEY) return process.env.ELIXIRDRIFT_KEY.trim();
  try {
    return fs.readFileSync(path.join(os.homedir(), '.elixirdrift', 'license'), 'utf8').trim();
  } catch (e) {
    return null;
  }
}

function hasPro() {
  const key = readLicenseKey();
  return !!(key && verifyLicense(key));
}

// ---------------------------------------------------------------------------------------
// Version-source parsing — Elixir versions are compared at MAJOR.MINOR granularity (1.14 vs
// 1.17 carry real compiler/warning/feature differences; a patch bump, e.g. 1.17.1 vs 1.17.3,
// never does) — same boundary choice as Ruby/Python/Rust. Every version is folded into a
// single comparable integer key: major*100 + minor.
// ---------------------------------------------------------------------------------------

// First "X.Y" (or "X.Y.Z", patch ignored) pair in a string -> integer key, or null.
// "1.17.3" -> 117, "1.14" -> 114, "latest" (no minor) -> null (ambiguous, not a real pin).
function parseVersionKey(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/(\d+)\.(\d+)/);
  if (!m) return null;
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

// mix.exs project()'s "elixir:" requirement string -> { min, max, exact } (integer keys, max
// exclusive) or null. Verified directly against elixir.hexdocs.pm/Version.html (Principle
// XXII) before writing this: Elixir's "~>" (tilde) requirement is the INVERSE of the pattern
// this lane's pydrift-ci/godrift-ci siblings already shipped for Python's "~=" —
//   "~> X.Y.Z" (patch given)   locks the MINOR level: >= X.Y.Z and < X.(Y+1).0
//     -> at major.minor granularity this is an EXACT pin on minor Y (patch floats below it,
//        but a minor bump anywhere fails the requirement either way)
//   "~> X.Y"   (patch omitted) locks the MAJOR level: >= X.Y.0 and < (X+1).0.0
//     -> at major.minor granularity this is a FLOOR at minor Y with an upper cap at the next
//        major, the same shape godrift-ci/rustdrift-ci already model as {min, max}
// Also supports a bare ">=X.Y" (optionally "and <X.Y"), "==X.Y(.Z)", and a bare "X.Y(.Z)".
function parseElixirRequirement(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  const str = s.trim();
  const tildePatch = str.match(/^~>\s*(\d+)\.(\d+)\.(\d+)$/);
  if (tildePatch) {
    const k = parseInt(tildePatch[1], 10) * 100 + parseInt(tildePatch[2], 10);
    return { min: null, max: null, exact: k };
  }
  const tildeMinor = str.match(/^~>\s*(\d+)\.(\d+)$/);
  if (tildeMinor) {
    const major = parseInt(tildeMinor[1], 10);
    const minK = major * 100 + parseInt(tildeMinor[2], 10);
    return { min: minK, max: (major + 1) * 100, exact: null };
  }
  const exact = str.match(/^==\s*(\d+)\.(\d+)/);
  if (exact) {
    return { min: null, max: null, exact: parseInt(exact[1], 10) * 100 + parseInt(exact[2], 10) };
  }
  const ge = str.match(/>=\s*(\d+)\.(\d+)/);
  const lt = str.match(/<\s*(\d+)\.(\d+)/);
  if (ge) {
    const minK = parseInt(ge[1], 10) * 100 + parseInt(ge[2], 10);
    const maxK = lt ? parseInt(lt[1], 10) * 100 + parseInt(lt[2], 10) : null;
    return { min: minK, max: maxK, exact: null };
  }
  const bare = str.match(/^(\d+)\.(\d+)/);
  if (bare) {
    return { min: null, max: null, exact: parseInt(bare[1], 10) * 100 + parseInt(bare[2], 10) };
  }
  return null;
}

function keySatisfiesRange(key, range) {
  if (key == null || !range) return true;
  if (range.exact != null) return key === range.exact;
  if (range.min != null && key < range.min) return false;
  if (range.max != null && key >= range.max) return false;
  return true;
}

// asdf's .tool-versions: one tool per line, "<tool> <version> [fallback-version ...]".
// Verified directly against asdf-vm.com/manage/configuration.html (Principle XXII): the first
// version token is the one actually used; the rest is an ordered fallback list, not a range.
// Comments start with "#".
function readToolVersionsElixir(rootDir) {
  const p = path.join(rootDir, '.tool-versions');
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  for (const line of lines) {
    const noComment = line.split('#')[0].trim();
    if (!noComment) continue;
    const parts = noComment.split(/\s+/);
    if (parts[0] !== 'elixir') continue;
    const raw = parts[1];
    if (!raw) continue;
    return { raw, key: parseVersionKey(raw) };
  }
  return null;
}

// mix.exs's "elixir:" key inside project() — a single targeted regex, deliberately narrow
// (same discipline as pydrift-ci's requires-python extraction): matches `elixir: "..."` or
// `elixir: '...'` anywhere in the file rather than parsing it as real Elixir source.
function readMixExsElixir(rootDir) {
  const p = path.join(rootDir, 'mix.exs');
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8');
  const m = text.match(/elixir:\s*["']([^"']+)["']/);
  if (!m) return null;
  return { raw: m[1], range: parseElixirRequirement(m[1]) };
}

const DEFAULT_EXCLUDE_DIRS = new Set(['node_modules', '.git', '_build', 'deps', 'cover']);
function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir)) {
    if (DEFAULT_EXCLUDE_DIRS.has(e)) continue;
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Every "FROM elixir:<tag>" line in every Dockerfile under rootDir. Verified the official tag
// shape directly against the Docker Hub "elixir" image page (Principle XXII):
// "<version>[-otp-<otp-version>][-variant]", e.g. "1.17.3-otp-27-alpine" — the OTP suffix and
// any variant (slim/alpine) are stripped before parsing the version; a tag with no minor
// component ("elixir:latest") is ambiguous and skipped, same as every prior sibling.
function findDockerfilePins(rootDir) {
  const pins = [];
  for (const fsPath of walk(rootDir)) {
    const base = path.basename(fsPath);
    if (!/^Dockerfile(\..+)?$/.test(base)) continue;
    const text = fs.readFileSync(fsPath, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*FROM\s+elixir:([^\s]+)/i);
      if (!m) continue;
      const tag = m[1];
      const key = parseVersionKey(tag);
      if (key == null) continue;
      pins.push({ source: `${path.relative(rootDir, fsPath)}:${i + 1}`, raw: tag, key });
    }
  }
  return pins;
}

// Every "elixir-version:" declaration in every .github/workflows/*.yml(.yaml) file — the flat
// key erlef/setup-beam reads (verified directly against its own README, Principle XXII: the
// "otp-version"/"elixir-version" inputs, no version-file auto-read unless "version-file" is
// explicitly set). Supports a scalar value and both inline and block arrays. A matrix (more
// than one distinct value declared together) is reported but never compared.
function findWorkflowPins(rootDir) {
  const pins = [];
  const wfDir = path.join(rootDir, '.github', 'workflows');
  if (!fs.existsSync(wfDir)) return pins;
  for (const e of fs.readdirSync(wfDir)) {
    if (!/\.ya?ml$/i.test(e)) continue;
    const fsPath = path.join(wfDir, e);
    const lines = fs.readFileSync(fsPath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)elixir-version:\s*(.*)$/);
      if (!m) continue;
      const indent = m[1].length;
      const rest = m[2].trim();
      let values = [];
      if (rest.startsWith('[')) {
        const inline = rest.match(/\[([^\]]*)\]/);
        if (inline) values = inline[1].split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, ''));
      } else if (rest) {
        values = [rest.replace(/^['"]|['"]$/g, '')];
      } else {
        let j = i + 1;
        while (j < lines.length) {
          const bm = lines[j].match(/^(\s*)-\s*(.+)$/);
          if (!bm || bm[1].length <= indent) break;
          values.push(bm[2].trim().replace(/^['"]|['"]$/g, ''));
          j++;
        }
      }
      if (!values.length) continue;
      const loc = `${path.relative(rootDir, fsPath)}:${i + 1}`;
      if (values.length > 1) {
        pins.push({ source: loc, raw: values.join(','), key: null, matrix: true, values });
      } else {
        const key = parseVersionKey(values[0]);
        if (key != null) pins.push({ source: loc, raw: values[0], key });
      }
    }
  }
  return pins;
}

// ---------------------------------------------------------------------------------------
// Drift check
// ---------------------------------------------------------------------------------------
function buildReport(rootDir, opts) {
  opts = opts || {};
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new ConfigError(`${rootDir} is not a directory`);
  }
  const toolVersions = readToolVersionsElixir(rootDir);
  const mixElixir = readMixExsElixir(rootDir);
  const pins = [];
  if (toolVersions && toolVersions.key != null) {
    pins.push({ source: '.tool-versions', raw: toolVersions.raw, key: toolVersions.key });
  }

  const pro = !!opts.pro;
  let matrixSources = [];
  if (pro) {
    pins.push(...findDockerfilePins(rootDir));
    const wfPins = findWorkflowPins(rootDir);
    matrixSources = wfPins.filter((p) => p.matrix).map((p) => p.source);
    pins.push(...wfPins.filter((p) => !p.matrix));
  }

  const findings = [];

  const distinctKeys = new Set(pins.map((p) => p.key));
  if (distinctKeys.size > 1) {
    findings.push({
      rule: 'pinMismatch',
      message: `Pinned Elixir versions disagree: ${pins.map((p) => `${p.source}=${p.raw}`).join(', ')}`,
      pins,
    });
  }

  if (mixElixir && mixElixir.range) {
    for (const p of pins) {
      if (!keySatisfiesRange(p.key, mixElixir.range)) {
        findings.push({
          rule: 'mixElixirMismatch',
          message: `${p.source} pins Elixir ${p.raw}, which does not satisfy mix.exs elixir requirement "${mixElixir.raw}"`,
          source: p.source,
          raw: p.raw,
          mixElixir: mixElixir.raw,
        });
      }
    }
  }

  return {
    breach: findings.length > 0,
    pro,
    sources: { toolVersions: toolVersions && toolVersions.raw, mixElixir: mixElixir && mixElixir.raw, pins },
    matrixSources,
    findings,
  };
}

class ConfigError extends Error {}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

function printHumanReport(result) {
  console.log(`elixirdrift-ci — mode: ${result.pro ? 'Pro (tool-versions + mix.exs + Dockerfile + CI workflows)' : 'free (tool-versions + mix.exs only)'}`);
  if (result.matrixSources.length) {
    console.log(`  (skipped as intentional matrix testing, not drift: ${result.matrixSources.join(', ')})`);
  }
  if (!result.findings.length) {
    console.log('  no drift found.');
  } else {
    for (const f of result.findings) console.log(`  DRIFT  [${f.rule}]  ${f.message}`);
  }
  if (!result.pro) {
    console.log('  (free mode checked .tool-versions + mix.exs only — Pro also checks every Dockerfile and GitHub Actions workflow: https://elixirdrift-ci.madeforthisday.com)');
  }
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._[0];

  if (args.help || !command) {
    console.log('Usage: node cli.js check [--dir <path>] [--json]');
    process.exit(command ? 0 : 2);
    return;
  }
  if (command !== 'check') {
    console.error(`Unknown command "${command}". Only "check" is supported.`);
    process.exit(2);
    return;
  }

  const dir = args.dir ? path.resolve(process.cwd(), args.dir) : process.cwd();
  let result;
  try {
    result = buildReport(dir, { pro: hasPro() });
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`elixirdrift-ci config error: ${e.message}`);
      process.exit(2);
      return;
    }
    throw e;
  }

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printHumanReport(result);

  process.exit(result.breach ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  buildReport, verifyLicense, verifyLicenseWith, parseVersionKey, parseElixirRequirement,
  keySatisfiesRange, findDockerfilePins, findWorkflowPins, readToolVersionsElixir,
  readMixExsElixir,
};
