# ScriptFrameClient

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.0.4.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Install as an app (PWA)

The client ships a web app manifest (`public/manifest.webmanifest`) plus app icons
(`public/assets/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
`apple-touch-icon.png`), so the production build can be added to a phone's home
screen and launched in a standalone window. `src/index.html` links the manifest
and the mobile meta tags (`theme-color`, `apple-mobile-web-app-*`,
`apple-touch-icon`).

Install it on a device like this:

- **Android / Chrome:** open the deployed URL and use the browser menu's
  "Install app" / "Add to Home screen" entry.
- **iOS / Safari:** open the deployed URL, tap Share, then "Add to Home Screen".

Two hosting requirements matter for the install experience:

1. The app must be served over HTTPS (or `localhost`) — a manifest is only
   honored in a secure context.
2. `manifest.webmanifest` and `public/assets/*` must be served from the
   application root, which is where the Angular build copies the `public/`
   directory.

A service worker is not required for installability (see MDN's "Making PWAs
installable"), and this client does not register one yet. Add it with the
`ng add @angular/pwa` schematic (`@angular/service-worker`) if you want an
offline app shell and the richest install experience on Android, where the
browser can then also surface the install prompt itself.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
