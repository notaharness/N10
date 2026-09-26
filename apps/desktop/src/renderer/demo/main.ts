// Order matters: the mock host must be on `window.n10` before any
// renderer module evaluates.
import './install-host.js';
import '../main.js';
