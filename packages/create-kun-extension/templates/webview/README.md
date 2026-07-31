# {{DISPLAY_NAME}}

Generated framework-neutral Kun Webview extension for Extension API 1.x. The
Webview uses only the sandbox Host transport and a CSP with `connect-src 'none'`.
Vite bundles the public API client and rewrites browser assets to confined,
relative URLs; do not replace the Webview build with plain `tsc` output because
browsers cannot resolve npm package specifiers such as `@kun/extension-api`.

```sh
npm install
npm test
npm run validate
npm run pack
```

Developer documentation: https://kun.dev/extensions/1/
