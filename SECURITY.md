# Security Policy

This policy covers the Chrome extensions in this repository. The toolkit
library and its hosted service have their own policy in the toolkit
repository.

## Read this before installing adapters

Custom adapters are **linted but not sandboxed**. They are registered as
Chrome user scripts and run with full access to every page they touch. Only
install adapters you trust, from people you trust. Adapters are written to be
reversible, which means their page changes can be undone; it does not limit
what a malicious adapter could read or do while it runs.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in these extensions, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainers directly at [dcelin@stanford.edu](mailto:dcelin@stanford.edu)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work with you to understand and address the issue.

## Security Considerations

### API Keys

- Gemini API keys are stored in `chrome.storage.sync`, which means the key follows you to other Chrome browsers signed into the same Google account
- Keys are transmitted only to Google's API endpoints over HTTPS. The Gemini API takes the key as a URL query parameter; avoiding that would need a proxy server, and this is a client-side extension by design
- The extensions never log or transmit API keys elsewhere

### Content Script Execution

- Content scripts run in an isolated world separate from page scripts
- AI-generated text content uses `textContent` for safe DOM insertion
- Reader mode sanitizes extracted HTML before `innerHTML` insertion (tag/attribute allowlist)
- We do not use `eval()` or `document.write()`

### Data Handling

- User preferences are stored in `chrome.storage.sync`; the profile and memory stay on the device by default
- **Sensitive sites**: banking, health, and government sites default to no-memory zones. That gates what is *remembered* about you there (nothing, unless you opt in per site), not whether a page is *adapted*
- **Remote mode exists and is off by default.** If you configure a server URL and token in the options page, Librarian calls, including your profile, go to that server. A build made from a local config file can arrive with a server pre-configured; a plain install from this repository cannot, because that config file is never committed
- **Cross-app sharing goes through explicit grants** you approve and can revoke. Revoking removes the grant and stops all further reads; it does not reach into another app to delete what it already received. Free text you wrote and the system's confidence scores are never shared through grants
- No user data is transmitted to third parties (except the Gemini API for AI features, and your own server if you enable remote mode)
- Custom adapters are linted before execution but are **not** sandboxed — they are registered as Chrome user scripts and run with full page access, which is why the extension warns users to only install adapters they trust
- Both extensions request access to all sites (`<all_urls>`), which is what lets them adapt any page; the memory pipeline records only discrete acts you take (changing a setting, applying a profile, saving an action, starting an agent task), not your browsing or typing

### Dependencies

- We minimize dependencies and audit them regularly
- Bundled third-party code is version-locked and recorded in [VENDORED.md](VENDORED.md)

## Security Best Practices for Contributors

1. Never use `innerHTML` with user/AI-generated content without escaping
2. Avoid `eval()`, `Function()`, and similar dynamic code execution
3. Use `textContent` for text-only insertions
4. Validate all inputs from external sources (AI responses, user input)
5. Keep dependencies up to date

## Acknowledgments

We thank our security researchers and community members who help keep this project secure.
