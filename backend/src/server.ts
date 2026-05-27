// Telemetry must be the *first* import so the Application Insights SDK can
// patch Node's module loader before HTTP / Cosmos / Express are required.
import './telemetry.js';
import { createApp } from './app.js';
import { config } from './config.js';

createApp()
  .then((app) => {
    app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(
        `[server] Portfolio tracker API listening on http://localhost:${config.port}` +
          ` (driver=${config.storageDriver}, dataDir=${config.dataDir})`
      );
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[server] failed to start', err);
    process.exit(1);
  });
