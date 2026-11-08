# Third-party components

Distribution license texts for the bundled frontend dependencies are copied from
their installed packages into `/licenses/` during prebuild. The build fails when
a required license is missing. Versions are recorded in frontend/package-lock.json.

- Golos Text and Unbounded: SIL Open Font License 1.1. Font files are hosted locally.
- PDF.js: Apache License 2.0. Both main library and worker use the package's legacy
  build. The application additionally installs `Promise.withResolvers` when absent
  in both the main realm and its bundled worker entry point.
- React, React DOM, Three.js, Lucide, i18next, react-i18next and TanStack Query:
  license texts are included from the installed npm packages.

The server uses PDFium via pypdfium2. Its wheel includes PDFium and dependency
licenses; preserve those installed package files in distributed images.
Docker's seccomp policy base is Apache-2.0; see infra/security/UPSTREAM_LICENSE.

Page and UI sounds are synthesized in application code; no third-party recordings
or commercial artwork are used. example.jpg is a user-provided visual reference.
