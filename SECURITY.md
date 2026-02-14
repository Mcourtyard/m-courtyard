# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.3.x   | ✅ Current release |
| < 0.3   | ❌ No longer supported |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue**
2. Email us at: **tuwenbo0112@gmail.com**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge your report within **48 hours** and aim to release a fix within **7 days** for critical issues.

## Scope

M-Courtyard runs entirely on your local machine. The main security concerns are:

- **Local file access**: The app reads/writes files in its project directories
- **Python script execution**: ML scripts run locally via `mlx-lm` and `uv`
- **Ollama communication**: Local HTTP API calls to Ollama (localhost only)
- **No cloud/network**: No data is sent to external servers

## Recognition

We appreciate responsible disclosure and will credit reporters in our release notes (unless you prefer to remain anonymous).
