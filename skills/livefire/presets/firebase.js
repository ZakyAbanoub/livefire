// livefire preset — Firebase / Firestore.
//
// Family A (authz declarative in the datastore): access control is Firestore/Storage SECURITY
// RULES (a per-path allow/deny DSL — the NoSQL cousin of row-level DB policies), sometimes plus checks in Cloud
// Functions. Ground truth is read with the Admin SDK, which BYPASSES rules — that read is the
// evidence. Run against the local Firebase Emulator Suite, never a live project.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const firebaseAdapter = {
  id: 'firebase',

  detect(repo) {
    const deps = (repo && repo.deps) || {}
    const files = (repo && repo.files) || []
    return !!(deps.firebase || deps['firebase-admin'] || deps['firebase-functions']) || files.includes('firebase.json') || files.includes('firestore.rules')
  },

  repoContext: 'A Firebase app. Authorization lives in FIRESTORE/STORAGE SECURITY RULES (a per-path allow read/write DSL keyed on request.auth + resource data — the declarative NoSQL analogue of row-level policies), sometimes with additional checks in Cloud Functions/callable functions. Wrong actors: an unauthenticated client (no ID token), an authenticated user with zero membership in the target tenant, and an authenticated user with the wrong custom-claim/role.',

  db: 'Run against the LOCAL Firebase Emulator Suite (`firebase emulators:start`) — never a live project. Use the Admin SDK (service-account / emulator admin) to plant fixtures and run the confirming READ, which BYPASSES security rules — that admin read is the ground truth. Client reads/writes go through the rules.',

  actors: 'Build three client contexts (Firestore rules test SDK or emulator clients): (1) UNAUTH — no ID token; (2) OUTSIDER — a signed-in user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a signed-in user with the wrong custom claim / role. Plus the Admin SDK for planting + the confirming (rules-bypassing) read.',

  inventorySql: 'Authorization is in the rules DSL, not SQL grants (say so). Enumerate: (a) every Firestore/Storage rules `match` block → its allow read/write condition — FLAG paths with `allow read/write: if true`, missing `request.auth != null`, or an ownership/tenant check that reads the WRONG document field; (b) callable/HTTPS Cloud Functions → their in-function auth (context.auth) + membership check — FLAG functions that trust client-supplied ids without re-checking membership; (c) any collection holding tenant/PII data whose read rule is broader than its owner. Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'npm test',

  emitTestHint: 'Write a @firebase/rules-unit-testing test asserting the wrong actor is denied a read/write, PAIRED with an Admin-SDK read confirming the document is unchanged (Admin bypasses rules, so it is ground truth). RED-first.',
}
