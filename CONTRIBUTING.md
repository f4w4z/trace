# Contributing to Trace

Thanks for your interest in contributing to Trace! This document outlines the process for
contributing to this project.

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/trace.git
   cd trace
   ```
3. **Set up** the development environment:
   ```bash
   cp .env.example .env   # configure your environment
   npm install
   docker compose up -d   # start Supermemory Local
   npm run dev            # start with hot-reload
   ```

## Development Workflow

1. Create a **feature branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes — keep commits small and focused.
3. Run checks before pushing:
   ```bash
   npm run lint    # type-check
   npm test        # run tests
   ```
4. Push your branch and open a **Pull Request** against `main`.

## Code Style

- **TypeScript** for all backend code in `src/`.
- Use **ESM** imports (`import` / `export`).
- Follow existing naming conventions and file structure.
- Keep functions focused — one responsibility per function.
- Add meaningful comments for non-obvious logic.

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add clipboard redaction for SSH keys
fix: handle missing browser history gracefully
docs: update API endpoint table in README
```

Prefixes: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.

## Pull Request Guidelines

- **Describe** what your PR does and why.
- **Link** any related issues.
- **Add tests** for new functionality.
- **Update documentation** if you change APIs or configuration.
- Keep PRs focused — one feature or fix per PR.

## Reporting Bugs

Open an issue with:

- A clear title and description.
- Steps to reproduce the bug.
- Expected vs. actual behavior.
- Your OS, Node.js version, and Docker version.

## Suggesting Features

Open an issue with the `enhancement` label. Describe:

- The problem you're trying to solve.
- Your proposed solution.
- Any alternatives you've considered.

## Security

If you discover a security vulnerability, please follow the process described in
[SECURITY.md](SECURITY.md). **Do not** open a public issue for security vulnerabilities.

## License

By contributing to Trace, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
