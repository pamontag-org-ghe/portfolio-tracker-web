/**
 * Application Insights bootstrap.
 *
 * Imported as the *very first* thing in src/server.ts so the SDK can hook
 * into Node's module loader before HTTP / Cosmos / Express modules are
 * required — that's what enables auto-collection of outgoing requests,
 * dependencies, exceptions and console output.
 *
 * Activates only when APPLICATIONINSIGHTS_CONNECTION_STRING is set, so local
 * dev (and unit-test runs without the env var) are unaffected.
 */
import appInsights from 'applicationinsights';

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

if (connectionString) {
  appInsights
    .setup(connectionString)
    .setAutoCollectConsole(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectRequests(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectPerformance(true, true)
    .setSendLiveMetrics(false)
    .setInternalLogging(false, false)
    .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
    .start();

  const client = appInsights.defaultClient;
  client.context.tags[client.context.keys.cloudRole] = process.env.WEBSITE_SITE_NAME ?? 'portfolio-tracker-api';

  // eslint-disable-next-line no-console
  console.log('[telemetry] Application Insights enabled (cloudRole=%s)', client.context.tags[client.context.keys.cloudRole]);
} else {
  // eslint-disable-next-line no-console
  console.log('[telemetry] APPLICATIONINSIGHTS_CONNECTION_STRING not set; telemetry disabled.');
}

export const telemetryClient = connectionString ? appInsights.defaultClient : null;
