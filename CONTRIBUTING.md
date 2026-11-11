# Contributing

Thanks for helping. This project is deliberately small: no runtime dependencies and no build step.
Please keep it that way.

## Ways to help

- **Test other launch monitors or connectors** and report what works. Include the device, software versions and connector.
- **Improve the ball flight model** in `public/physics.js`. Add a test in `test/physics.test.js` with real reference numbers.
- **Visuals and UX** in `public/index.html`.

## Setup

```
git clone <your fork>
cd teebox
npm test
npm start
```

Needs Node.js 18 or newer.

## Pull requests

- Keep changes focused. Run `npm test` first. CI runs it on Node 18, 20 and 22.
- For protocol changes, add a case to `test/protocol.test.js`.
- If a launch monitor sends data that doesn't parse, open an issue with a sample of the JSON (remove anything personal).
