# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a Vulnerability

If you discover a security vulnerability in Trace, **please do not open a public issue**.

Instead, report it privately by emailing the maintainer or by using
[GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository.

Please include:

- A description of the vulnerability.
- Steps to reproduce or a proof of concept.
- The potential impact.
- Suggested fix (if any).

## Response Timeline

- **Acknowledgment** — within 48 hours of the report.
- **Initial assessment** — within 1 week.
- **Fix and disclosure** — coordinated with the reporter.

## Security Design

Trace is designed with local-first privacy in mind:

- All data stays on your machine by default — nothing leaves unless you configure an external LLM
  endpoint.
- Sensitive clipboard content (passwords, API keys, tokens) is automatically redacted before
  storage.
- Supermemory Local runs as a local Docker container; no external network calls.
- The API binds to `localhost` only.

Thank you for helping keep Trace and its users safe.
