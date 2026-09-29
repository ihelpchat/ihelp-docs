import { captureFailureLog } from './capture-diagnostics.mjs';

let installed = false;
export function installCaptureRejectionSafety() {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => {
    // Last-resort guard only; capture routes and event handlers catch locally.
    console.error(captureFailureLog(reason));
  });
}
