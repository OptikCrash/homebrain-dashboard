const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('Postgres readiness requires correct TCP credentials and a specific wrong-password rejection', () => {
  execFileSync('python3', ['-c', `
import os
import subprocess
from types import SimpleNamespace
from auth_check import check_auth

os.environ.update(POSTGRES_USER='fixture', POSTGRES_DB='fixture', POSTGRES_PASSWORD='fixture-password')
def result(code=0, stdout='1\\n', stderr=''):
    return SimpleNamespace(returncode=code, stdout=stdout, stderr=stderr)

def verify(responses, fails):
    calls = []
    def run(command, **options):
        calls.append((command, options))
        return responses[len(calls) - 1]
    try:
        check_auth(run)
        assert not fails, 'unsafe authentication was accepted'
    except RuntimeError as error:
        assert fails
        assert 'fixture-password' not in str(error)
        assert 'No credentials were changed' in str(error)
    assert calls[0][0][1:5] == ['-X', '-w', '-h', '127.0.0.1']
    assert calls[0][1]['env']['PGPASSWORD'] == 'fixture-password'
    assert calls[1][1]['env']['PGPASSWORD'] != 'fixture-password'
    assert calls[1][1]['env']['LC_ALL'] == 'C'

rejected = result(2, '', 'FATAL: password authentication failed for user "fixture"')
verify([result(), rejected], False)
verify([result(), result()], True)  # trust or another passwordless method
verify([result(), result(2, '', 'connection refused')], True)
verify([result(), result(2, '', 'role does not exist')], True)
verify([result(), result(2, '', 'database does not exist')], True)
verify([result(), result(2, '', 'timeout expired')], True)
verify([rejected, rejected], True)  # old volume with different credentials
verify([result(stdout=''), rejected], True)
for exception in [OSError(), subprocess.TimeoutExpired('psql', 10)]:
    def broken(*args, **kwargs):
        raise exception
    try:
        check_auth(broken)
        assert False
    except RuntimeError as error:
        assert 'could not complete' in str(error)
`], {
    cwd: path.resolve(__dirname, '../../postgres'),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    stdio: 'pipe',
  });
});
