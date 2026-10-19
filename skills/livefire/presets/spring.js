// livefire preset — Spring Boot (Java/Kotlin).
//
// The extreme of "authz in code": Spring Security method annotations (@PreAuthorize/@Secured),
// SecurityFilterChain URL rules, and service-layer ownership checks. No DB policy catalog. So
// `inventorySql` is a route/method → guard map + unscoped-repository-query hunt; the DB-grant
// dump is n/a. Ground truth is read via a direct JDBC connection, bypassing service authz.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const springAdapter = {
  id: 'spring',

  detect(repo) {
    const files = (repo && repo.files) || []
    return files.includes('pom.xml') || files.includes('build.gradle') || files.includes('build.gradle.kts')
  },

  repoContext: 'A Spring Boot app (Java/Kotlin). Authorization lives in CODE: Spring Security method security (@PreAuthorize / @PostAuthorize / @Secured), the SecurityFilterChain URL rules, and ownership checks in the service layer. Wrong actors: anonymous (no token), an authenticated user in the wrong tenant, and an authenticated principal with the wrong authority/role.',

  db: 'Reach the LOCAL dev database from application-{dev,local}.yml/properties (Postgres/MySQL/H2) — disposable only. Use a direct JDBC connection (or a superuser client) to plant fixtures and run the confirming SELECT, BYPASSING the service layer and any JPA filters — that raw read is the ground truth.',

  actors: 'Build three actor principals: (1) ANONYMOUS — no Authorization header / no session; (2) OUTSIDER — a valid token/session for a user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a valid token whose authorities lack the required role. For live runs obtain real tokens from the auth endpoint; for tests, MockMvc with @WithMockUser per role. Plus a direct JDBC admin connection for planting + confirming.',

  inventorySql: 'Authorization is in code, so the "inventory" is a MAP, not a SQL dump (DB-grant enumeration is n/a for Spring — say so). Enumerate: (a) every @RestController/@Controller endpoint → its @PreAuthorize/@Secured/@RolesAllowed annotation AND the matching SecurityFilterChain rule (flag endpoints with permitAll or no method-security that touch tenant data); (b) every Spring Data repository / JPQL query that loads by a caller-supplied id WITHOUT a tenant/owner predicate; (c) any @PreAuthorize using a SpEL expression that can be satisfied by the wrong tenant. Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: './gradlew test',

  emitTestHint: 'Write a MockMvc / @SpringBootTest integration test hitting the endpoint as each wrong actor and asserting refused, PAIRED with a direct JDBC SELECT confirming the row is unchanged — bypassing the service layer so the read is ground truth. RED-first.',
}
