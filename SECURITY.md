# Security policy

## Supported versions

Fixes go into the latest published release of
[`@notaharness/n10`](https://www.npmjs.com/package/@notaharness/n10). Older
releases do not receive fixes, so upgrade to get them.

## Reporting a vulnerability

Report privately through GitHub:
[open a private report](https://github.com/notaharness/n10/security/advisories/new),
or choose **Report a vulnerability** on the repository's Security tab. Do not
open a public issue, pull request or discussion.

Include the n10 version, your platform, steps to reproduce and what an attacker
could do. n10 runs agents with your Git provider and agent credentials, so
issues that expose credentials or run commands without your consent are in scope.
Report a flaw in an agent CLI or in `gh` to that tool's maintainers.

## After you report

1. We acknowledge the report within 7 days.
2. We confirm the issue, or explain why we don't consider it a vulnerability.
3. We develop the fix in a private advisory and keep you updated there. You can
   comment on the advisory and test the fix.
4. We publish a release with the fix, then publish the advisory. It credits you
   unless you ask us not to.

Please keep the report private until the advisory is published.
