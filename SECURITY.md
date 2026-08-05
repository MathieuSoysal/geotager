# Security policy

Geotager's whole claim is that a photo's location is read, changed and removed **without the photo
leaving the machine, and without any byte moving that should not**. A flaw in either half is a
security issue here, even where another project would file it as a bug.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:
**<https://github.com/MathieuSoysal/geotager/security/advisories/new>**

Do not open a public issue for anything you believe is exploitable, and do not attach a personal
photo whose real location is in the metadata — reproduce with a test file if you can.

You will get an acknowledgement within a few days. Please leave reasonable time for a fix and a
release before disclosing publicly; you will be credited in the advisory unless you prefer not to
be.

## What counts

- Anything that makes the site, the service worker, the CLI or the library **send data anywhere**
  — the promise is that nothing reaches the network except the opt-in map tiles.
- A write that **modifies bytes outside the ranges the engine declares**, or a removal that leaves
  a recoverable location behind (including the descriptive text packet and video variants).
- Anything that lets a crafted file escape the verification pass — a produced file that ExifTool or
  another reader sees differently from what the engine reported.
- The usual web classes too, on <https://geotager.app>: XSS, cache poisoning through the service
  worker, header or CSP bypasses.

## Supported versions

The live site at <https://geotager.app> always runs the latest build of `main`. For the npm
packages (`@geotager/core`, `geotager`), only the latest published version receives fixes.
