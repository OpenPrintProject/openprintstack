# Contributing to Open Print Stack

Thanks for your interest in contributing! Open Print Stack is a community project, and help of every kind is welcome, from code and documentation to bug reports and testing on printers we don't own.

## Ways to Contribute

- **Report bugs.** Open an issue describing what happened and what you expected.
- **Suggest features.** Open an issue explaining the problem you're trying to solve.
- **Test with your hardware.** Reports from different printer models and firmware are especially valuable.
- **Improve documentation.** Fixes, clarifications and examples are always appreciated.
- **Write code.** Pick up an open issue or propose a change.

## Reporting Bugs

Before opening an issue, check whether it has already been reported. When you report a bug, please include:

- What you did, what you expected and what actually happened
- Steps to reproduce the problem
- Your Open Print Stack version or commit
- Your deployment method, such as Docker or bare metal
- Printer make, model and firmware, if the issue involves a printer
- Relevant logs or screenshots

**Security issues should not be reported publicly.** See [SECURITY.md](SECURITY.md) instead.

## Development Setup

_Coming soon. This section will be filled in once the tech stack is chosen._

## Making Changes

The `main` branch is protected, so all changes go through pull requests.

1. Fork the repository, or create a branch if you have write access.
2. Create a branch with a descriptive name, such as `fix/job-queue-ordering` or `feat/printer-discovery`.
3. Make your changes, keeping each pull request focused on one thing.
4. Add or update tests and documentation where relevant.
5. Open a pull request explaining what changed and why, and link any related issues.

### Commit Messages

- Use the imperative mood, such as "Add printer status endpoint" rather than "Added printer status endpoint".
- Keep the first line short, ideally under 72 characters.
- Explain the *why* in the body when it isn't obvious.

## Licensing

Open Print Stack is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). By submitting a contribution, you agree that it will be licensed under the same terms.

New source files should start with a licence header:

```
SPDX-FileCopyrightText: <year> <your name>
SPDX-License-Identifier: AGPL-3.0-or-later
```
