#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Read-only GitHub/Supabase incident collector. Python 3.10+, standard library only.
No git writes, workflow reruns, SQL migrations, history repairs, or secret exports.
GitHub download is opt-in. Evidence may contain private metadata: review before sharing.
"""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

REPO_RE = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")


def require(name):
    if not shutil.which(name):
        raise RuntimeError(f"Missing executable: {name}. Install it before retrying.")


def invoke(argv, timeout=120):
    """No shell interpolation. Avoid printing arguments that could contain credentials."""
    env = os.environ.copy()
    if argv[0] == 'gh':
        # This incident targets GitHub.com, not an ambient enterprise GH_HOST.
        env['GH_HOST'] = 'github.com'
    p = subprocess.run(argv, text=True, capture_output=True, timeout=timeout, env=env)
    if p.returncode:
        raise RuntimeError(p.stderr.strip() or f"{argv[0]} exited {p.returncode}")
    return p.stdout


def gh_json(endpoint, paginate=False):
    args = ['gh', 'api', '--method', 'GET', endpoint]
    if paginate:
        args += ['--paginate', '--slurp']
    return json.loads(invoke(args, timeout=300))


def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + '\n')
    path.chmod(0o600)


def evidence_dir(base, prefix):
    base = Path(base).expanduser().resolve()
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    # A fresh private directory prevents accidental mixing of runs and overwrites.
    return Path(tempfile.mkdtemp(prefix=prefix + '-', dir=base))


def hash_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def migration_inventory(directory):
    directory = Path(directory)
    if not directory.is_dir():
        raise RuntimeError(f"Migration directory not found: {directory}")
    files, nonstandard = [], []
    for path in sorted(directory.iterdir()):
        if path.suffix != '.sql':
            continue
        if path.is_symlink() or not path.is_file():
            nonstandard.append(path.name)
            continue
        match = re.fullmatch(r'(\d+)_(.+)\.sql', path.name)
        if not match:
            nonstandard.append(path.name)
            continue
        files.append({'version': match[1], 'file': path.name,
                      'sha256': hash_file(path), 'bytes': path.stat().st_size})
    counts = Counter(item['version'] for item in files)
    return {'files': files, 'duplicates': sorted(v for v, n in counts.items() if n > 1),
            'nonstandard_sql_files': nonstandard,
            'non_14_digit_versions': sorted(v for v in counts if len(v) != 14)}


def compare_versions(local, remote):
    a, b = set(local), set(remote)
    return {'local_only': sorted(a - b), 'remote_only': sorted(b - a),
            'matching_versions': sorted(a & b),
            'warning': 'Matching versions do NOT prove matching SQL or database schema.'}


def inspect_artifact(path):
    item = {'path': str(path), 'bytes': path.stat().st_size,
            'MiB': round(path.stat().st_size / (1024 ** 2), 3),
            'sha256': hash_file(path), 'format_ok': False,
            'signature_verified': False}
    try:
        with zipfile.ZipFile(path) as z:
            # Avoid unbounded decompression for corrupt or unexpectedly huge archives.
            if sum(x.file_size for x in z.infolist()) > 2 * 1024 ** 3:
                item['error'] = 'Uncompressed size exceeds 2 GiB inspection limit'
                return item
            bad = z.testzip()
            expected = ('AndroidManifest.xml' if path.suffix.lower() == '.apk'
                        else 'base/manifest/AndroidManifest.xml')
            item['format_ok'] = bad is None and expected in z.namelist()
            if not item['format_ok']:
                item['error'] = 'CRC failure or expected Android manifest missing'
    except (zipfile.BadZipFile, RuntimeError, OSError, NotImplementedError) as exc:
        item['error'] = str(exc)
    return item


def locate(args):
    require('gh')
    invoke(['gh', 'auth', 'status', '--hostname', 'github.com'])
    pages = gh_json('user/repos?per_page=100&affiliation=owner,collaborator,organization_member', True)
    repos = [r['full_name'] for page in pages for r in page]
    for run in args.run:
        matches, errors = [], []
        for repo in repos:
            try:
                data = gh_json(f'repos/{repo}/actions/runs/{run}')
                matches.append({'repo': repo, 'run': run, 'url': data['html_url'],
                                'status': data['status'], 'conclusion': data.get('conclusion')})
            except RuntimeError as exc:
                if 'HTTP 404' not in str(exc):
                    errors.append({'repo': repo, 'error': str(exc)})
        print(json.dumps({'run': run, 'matches': matches, 'errors': errors,
                          'scope': 'Repositories visible to this gh login only; 404 can hide permission denial.'}, indent=2))
    return 0


def github(args):
    require('gh')
    if not REPO_RE.fullmatch(args.repo):
        raise RuntimeError('Use an exact OWNER/REPO, without URL, spaces, or placeholders.')
    invoke(['gh', 'auth', 'status', '--hostname', 'github.com'])
    out = evidence_dir(args.out, 'github')
    report, problems = [], False
    for run in args.run:
        folder = out / run
        folder.mkdir(mode=0o700)
        item = {'run': run, 'repo': args.repo}
        print(f'Inspecting {args.repo} run {run}', flush=True)
        try:
            meta = gh_json(f'repos/{args.repo}/actions/runs/{run}')
            save(folder / 'run.json', meta)
            item.update(status=meta['status'], conclusion=meta.get('conclusion'),
                        url=meta['html_url'], head_sha=meta['head_sha'])
            pages = gh_json(f'repos/{args.repo}/actions/runs/{run}/jobs?per_page=100', True)
            save(folder / 'jobs.json', [j for p in pages for j in p.get('jobs', [])])
            pages = gh_json(f'repos/{args.repo}/actions/runs/{run}/artifacts?per_page=100', True)
            artifacts = [a for p in pages for a in p.get('artifacts', [])]
            save(folder / 'artifacts.json', artifacts)
            item['artifacts'] = [{'name': a['name'], 'bytes': a['size_in_bytes'],
                                  'expired': a.get('expired'), 'expires_at': a.get('expires_at')}
                                 for a in artifacts]
            if meta['status'] != 'completed' or meta.get('conclusion') != 'success':
                problems = True
            if meta['status'] == 'completed' and meta.get('conclusion') not in ('success', 'skipped'):
                try:
                    log = invoke(['gh', 'run', 'view', run, '--repo', args.repo, '--log-failed'], 300)
                    (folder / 'failed.log').write_text(log)
                    item['log_note'] = 'Treat logs as private; redact before sharing.'
                except RuntimeError as exc:
                    item['log_error'] = str(exc)
            available = [a for a in artifacts if not a.get('expired', False)]
            if not available:
                item['artifact_note'] = 'No available artifacts; may be never uploaded, deleted, expired, or not yet uploaded. Inspect job logs.'
                if args.download:
                    problems = True
            elif args.download:
                destination = folder / 'downloads'
                destination.mkdir(mode=0o700)
                invoke(['gh', 'run', 'download', run, '--repo', args.repo,
                        '--dir', str(destination)], timeout=1800)
                item['packages'] = []
                for path in sorted(destination.rglob('*')):
                    if path.is_symlink() or not path.is_file():
                        continue
                    if path.suffix.lower() in ('.apk', '.aab'):
                        check = inspect_artifact(path)
                        item['packages'].append(check)
                        if not check['format_ok']:
                            problems = True
                if not item['packages']:
                    item['package_note'] = 'Artifacts downloaded, but no APK/AAB files found.'
                    problems = True
        except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as exc:
            item['error'] = str(exc)
            problems = True
        report.append(item)
        save(out / 'summary.json', report)
        print(json.dumps(item, indent=2), flush=True)
    print(f'Evidence saved: {out}')
    return 2 if problems else 0


def local(args):
    result = migration_inventory(args.migrations)
    print(json.dumps(result, indent=2))
    return 2 if result['duplicates'] or result['nonstandard_sql_files'] else 0


# Only catalog/history SELECTs; no app data, secrets, DDL, or history edits.
BACKEND_SQL = r'''
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS history_exists \gset
\if :history_exists
SELECT json_build_object('history_present', true, 'versions',
  (SELECT coalesce(json_agg(version ORDER BY version), '[]'::json)
   FROM supabase_migrations.schema_migrations));
\else
SELECT json_build_object('history_present', false, 'versions', '[]'::json);
\endif
SELECT json_build_object('database', current_database(), 'role', current_user,
 'rls_tables', (SELECT coalesce(json_agg(x), '[]'::json) FROM
 (SELECT n.nspname AS schema, c.relname AS table_name,
         c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p') AND n.nspname='public'
  ORDER BY c.relname) x));
ROLLBACK;
'''


def backend(args):
    require('psql')
    inventory = migration_inventory(args.migrations)
    for name in ('PGHOST', 'PGUSER', 'PGDATABASE', 'PGSSLROOTCERT'):
        if not os.environ.get(name):
            raise RuntimeError(f'Set {name} from your trusted database connection settings.')
    if os.environ.get('PGSSLMODE') != 'verify-full':
        raise RuntimeError('PGSSLMODE must be verify-full; do not weaken TLS to hide a certificate error.')
    if not Path(os.environ['PGSSLROOTCERT']).expanduser().is_file():
        raise RuntimeError('PGSSLROOTCERT must name an existing trusted certificate file.')
    if os.environ.get('PGPASSWORD'):
        raise RuntimeError('Unset PGPASSWORD. This tool prompts locally using psql -W.')
    out = evidence_dir(args.out, 'backend')
    env = os.environ.copy()
    env['PGCONNECT_TIMEOUT'] = '15'
    env['PGAPPNAME'] = 'termux-readonly-audit'
    print('Password is requested by psql locally; it is not saved in this report.', flush=True)
    # stderr remains attached so psql's terminal password prompt is visible.
    p = subprocess.run(['psql', '-X', '-W', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                       input=BACKEND_SQL, text=True, stdout=subprocess.PIPE,
                       env=env, timeout=150)
    if p.returncode:
        raise RuntimeError(f'psql failed ({p.returncode}); no schema changes were requested.')
    rows = [json.loads(line) for line in p.stdout.splitlines() if line.strip()]
    if len(rows) != 2 or not isinstance(rows[0].get('versions'), list):
        raise RuntimeError('Unexpected psql output; no comparison has been asserted.')
    history, catalog = rows
    result = {'local': inventory, 'history': history, 'catalog': catalog,
              'connection': {k: os.environ.get(k) for k in ('PGHOST','PGPORT','PGUSER','PGDATABASE')},
              'tls': 'verify-full', 'schema_equivalence_verified': False}
    if history['history_present']:
        result['comparison'] = compare_versions([f['version'] for f in inventory['files']],
                                                 [str(v) for v in history['versions']])
    else:
        result['warning'] = 'History relation absent. Check target and permissions; this does not prove the schema is empty.'
    save(out / 'backend-summary.json', result)
    print(json.dumps(result, indent=2))
    print(f'Evidence saved: {out}')
    diff = result.get('comparison', {})
    return 2 if (not history['history_present'] or diff.get('local_only') or diff.get('remote_only')
                 or inventory['duplicates'] or inventory['nonstandard_sql_files']) else 0


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('locate', help='Find which accessible repository owns a run; read-only')
    p.add_argument('--run', nargs='+', required=True)
    p.set_defaults(func=locate)
    p = sub.add_parser('github', help='Collect run/job/artifact evidence from an explicit repo')
    p.add_argument('--repo', required=True)
    p.add_argument('--run', nargs='+', required=True)
    p.add_argument('--download', action='store_true', help='Opt in to artifact downloads')
    p.add_argument('--out', default='~/termux-audit')
    p.set_defaults(func=github)
    p = sub.add_parser('local', help='Check migration files; never modifies them')
    p.add_argument('--migrations', required=True)
    p.set_defaults(func=local)
    p = sub.add_parser('backend', help='Read-only PostgreSQL history/catalog audit')
    p.add_argument('--migrations', required=True)
    p.add_argument('--out', default='~/termux-audit')
    p.set_defaults(func=backend)
    args = parser.parse_args()
    if hasattr(args, 'run') and any(not re.fullmatch(r'[1-9]\d*', r) for r in args.run):
        parser.error('Run IDs must be positive decimal integers.')
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print('\nCancelled; no remote changes requested.', file=sys.stderr)
        return 130
    except (RuntimeError, OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
