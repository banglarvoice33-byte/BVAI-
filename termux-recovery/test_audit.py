# SPDX-License-Identifier: MIT
import contextlib
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import audit


class AuditTests(unittest.TestCase):
    def test_matching_versions_not_schema_proof(self):
        r = audit.compare_versions(['1'], ['1'])
        self.assertEqual(r['local_only'], [])
        self.assertIn('NOT prove', r['warning'])

    def test_version_differences(self):
        r = audit.compare_versions(['1', '2'], ['2', '3'])
        self.assertEqual(r['local_only'], ['1'])
        self.assertEqual(r['remote_only'], ['3'])

    def test_inventory_hash_and_duplicates(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p/'20261007000000_a.sql').write_text('select 1;')
            (p/'20261007000000_b.sql').write_text('select 2;')
            r = audit.migration_inventory(p)
            self.assertEqual(r['duplicates'], ['20261007000000'])
            self.assertEqual(len(r['files'][0]['sha256']), 64)

    def test_nonstandard_file(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/'bad.sql').write_text('')
            self.assertEqual(audit.migration_inventory(d)['nonstandard_sql_files'], ['bad.sql'])

    def test_missing_directory(self):
        with self.assertRaises(RuntimeError):
            audit.migration_inventory('/does-not-exist-incident-audit')

    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p/'outside').write_text('select 1;')
            (p/'20261007000000_link.sql').symlink_to(p/'outside')
            self.assertIn('20261007000000_link.sql', audit.migration_inventory(p)['nonstandard_sql_files'])

    def test_private_unique_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            a = audit.evidence_dir(d, 'run')
            b = audit.evidence_dir(d, 'run')
            self.assertNotEqual(a, b)
            self.assertEqual(a.stat().st_mode & 0o777, 0o700)

    def test_apk_format_only_not_signature(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'test.apk'
            with zipfile.ZipFile(p, 'w') as z:
                z.writestr('AndroidManifest.xml', b'fake-test-manifest')
            r = audit.inspect_artifact(p)
            self.assertTrue(r['format_ok'])
            self.assertFalse(r['signature_verified'])

    def test_aab_format(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'test.aab'
            with zipfile.ZipFile(p, 'w') as z:
                z.writestr('base/manifest/AndroidManifest.xml', b'fake')
            self.assertTrue(audit.inspect_artifact(p)['format_ok'])

    def test_bad_archive(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'bad.apk'
            p.write_text('not a zip')
            self.assertFalse(audit.inspect_artifact(p)['format_ok'])

    def test_archive_without_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'bad.apk'
            with zipfile.ZipFile(p, 'w') as z:
                z.writestr('unrelated.txt', 'x')
            self.assertFalse(audit.inspect_artifact(p)['format_ok'])

    def test_api_is_get_paginated(self):
        with patch.object(audit, 'invoke', return_value='[]') as mock:
            audit.gh_json('repos/o/r/actions/runs/1/artifacts', True)
            argv = mock.call_args.args[0]
            self.assertIn('GET', argv)
            self.assertIn('--paginate', argv)
            self.assertIn('--slurp', argv)

    def test_no_shell_execution(self):
        fake = SimpleNamespace(returncode=0, stdout='ok', stderr='')
        with patch.object(audit.subprocess, 'run', return_value=fake) as mock:
            audit.invoke(['echo', 'a; touch /bad'])
            self.assertFalse(mock.call_args.kwargs.get('shell', False))

    def test_backend_sql_readonly(self):
        sql = audit.BACKEND_SQL.upper()
        self.assertIn('REPEATABLE READ READ ONLY', sql)
        self.assertIn('ROLLBACK;', sql)
        for forbidden in ('DROP TABLE', 'INSERT INTO', 'UPDATE SUPABASE', 'DELETE FROM'):
            self.assertNotIn(forbidden, sql)

    def test_reject_weak_tls(self):
        with tempfile.TemporaryDirectory() as d:
            args = SimpleNamespace(migrations=d, out=d)
            env = {'PGHOST': 'example', 'PGUSER': 'postgres', 'PGDATABASE': 'postgres',
                   'PGSSLROOTCERT': '/not-used', 'PGSSLMODE': 'require'}
            with patch.dict(os.environ, env, clear=True), patch.object(audit, 'require'):
                with self.assertRaisesRegex(RuntimeError, 'verify-full'):
                    audit.backend(args)

    def test_backend_mocked_integration(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            mig = root/'migrations'
            mig.mkdir()
            (mig/'20261007000000_test.sql').write_text('select 1;')
            cert = root/'root.crt'
            cert.write_text('mock cert; not used for real TLS')
            rows = [{'history_present': True, 'versions': ['20261007000000']},
                    {'database': 'postgres', 'role': 'auditor', 'rls_tables': []}]
            p = SimpleNamespace(returncode=0, stdout='\n'.join(map(json.dumps, rows)))
            env = {'PGHOST':'example', 'PGUSER':'auditor', 'PGDATABASE':'postgres',
                   'PGSSLROOTCERT':str(cert), 'PGSSLMODE':'verify-full'}
            with patch.dict(os.environ, env, clear=True), patch.object(audit, 'require'), \
                 patch.object(audit.subprocess, 'run', return_value=p) as mock, \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(audit.backend(SimpleNamespace(migrations=mig, out=root)), 0)
                self.assertIn('-W', mock.call_args.args[0])
                self.assertIn('-X', mock.call_args.args[0])
                self.assertNotIn('PGPASSWORD', mock.call_args.kwargs['env'])

    def test_github_mocked_failed_run_and_empty_artifacts(self):
        with tempfile.TemporaryDirectory() as d:
            def api(endpoint, paginate=False):
                if '/artifacts' in endpoint:
                    return [{'artifacts': []}]
                if '/jobs' in endpoint:
                    return [{'jobs': []}]
                return {'status':'completed', 'conclusion':'failure', 'html_url':'https://example/run', 'head_sha':'abc'}
            args = SimpleNamespace(repo='owner/repo', run=['42'], download=False, out=d)
            with patch.object(audit, 'require'), patch.object(audit, 'invoke', return_value='failed step'), \
                 patch.object(audit, 'gh_json', side_effect=api), \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(audit.github(args), 2)
            self.assertTrue(list(Path(d).rglob('failed.log')))
            report = json.loads(next(Path(d).rglob('summary.json')).read_text())
            self.assertIn('expired', report[0]['artifact_note'])


if __name__ == '__main__':
    unittest.main()
