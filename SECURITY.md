# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
private vulnerability reporting on this repository (Security tab, "Report a
vulnerability"), or e-mail osman.turalioglu@outlook.com with "Elastishot
security" in the subject.

You will get an acknowledgement within five working days, and a fix or a
mitigation plan as soon as the report is confirmed. Reporters are credited in
the changelog unless they prefer not to be.

## What to know when you run it

- Elastishot sends no telemetry. The CLI contacts only the URLs you pass it
  and the registry `opencv.js` is installed from.
- Run folders (`.elastishot/runs`) contain full-page screenshots and element
  maps of the pages you compared, including any text visible on them. Treat
  them like the pages themselves: keep them out of public artifacts when the
  pages are not public.
- Captures run a real browser against the URLs you give it, with the headers
  and storage state you configure. Do not point it at pages you are not
  allowed to load.
