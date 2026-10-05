# Security Policy

Open Print Stack runs on your own network and controls physical machines, so we take security seriously. Thank you for helping keep it and its users safe.

## Supported Versions

Open Print Stack is in early development and has no releases yet. Once releases begin, security fixes will target the latest release.

## Reporting a Vulnerability

**Please do not report security issues through public GitHub issues, discussions or pull requests.**

Report them privately through GitHub's private vulnerability reporting instead:

1. Go to the [Security tab](https://github.com/OpenPrintProject/openprintstack/security) of this repository.
2. Click **Report a vulnerability**.
3. Fill in the form with as much detail as you can.

Helpful details include:

- A description of the issue and its potential impact
- Steps to reproduce it, or a proof of concept
- The affected version or commit
- Your setup, such as the deployment method, printer models and firmware, where relevant

## What to Expect

- We'll acknowledge your report and keep you updated as we investigate.
- We'll work with you on a fix and agree a disclosure timeline before anything is made public.
- With your permission, we'll credit you in the advisory once the issue is fixed.

## Scope

Anything that compromises the confidentiality, integrity or availability of an Open Print Stack installation is in scope. Examples include:

- Bypassing authentication or authorisation
- Accessing or tampering with print files and job data
- Remote code execution or injection
- **Unsafe printer control**, such as being able to start prints, move axes or change heater temperatures without permission, or bypass safety limits
