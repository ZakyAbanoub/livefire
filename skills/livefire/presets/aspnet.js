// livefire preset — ASP.NET Core (.NET, C#).
//
// Big in enterprise. Authz: [Authorize] attributes + authorization policies/requirements/handlers,
// endpoint `.RequireAuthorization(...)`, and ownership checks with EF Core. Mirrors Spring.
// Family B (authz in code); ground truth via a direct DB read bypassing EF.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const aspnetAdapter = {
  id: 'aspnet',

  detect(repo) {
    const files = (repo && repo.files) || []
    return files.some((f) => f.endsWith('.csproj') || f.endsWith('.sln')) || files.includes('Program.cs') || files.includes('global.json')
  },

  repoContext: 'An ASP.NET Core (.NET/C#) app. Authorization lives in CODE: `[Authorize]` attributes + authorization policies (requirements + handlers), minimal-API `.RequireAuthorization(...)`, and ownership checks with EF Core. Wrong actors: an anonymous request, an authenticated user with zero membership in the target tenant, and an authenticated user whose claims/roles lack the policy.',

  db: 'Reach the LOCAL dev DB from appsettings.Development.json/user-secrets (SQL Server/Postgres via EF Core) — disposable only. Use a direct ADO.NET/Dapper connection (raw SQL) to plant fixtures and run the confirming read, BYPASSING EF query filters — that raw read is the ground truth.',

  actors: 'Build three actor principals: (1) ANONYMOUS — no Authorization header; (2) OUTSIDER — a valid token for a user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a valid token whose claims/roles fail the policy. Drive via WebApplicationFactory / HttpClient. Plus a direct DB connection for planting + confirming.',

  inventorySql: 'Authorization is in code (DB-grant enumeration is n/a — say so). Enumerate: (a) every controller action / minimal-API endpoint → its [Authorize(Policy=...)]/RequireAuthorization AND [AllowAnonymous] — FLAG endpoints touching tenant data with [AllowAnonymous] or no policy; (b) every EF Core query loading by a request-supplied id WITHOUT a tenant/owner predicate (`_db.X.FindAsync(id)` instead of a scoped `.Where(x => x.OwnerId == userId)`); (c) model binding / DTOs that accept ownership/tenant fields (over-posting). Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'dotnet test',

  emitTestHint: 'Write a WebApplicationFactory integration test hitting the endpoint as each wrong actor and asserting refused, PAIRED with a direct ADO.NET/Dapper SELECT confirming the row is unchanged — bypassing EF filters so the read is ground truth. RED-first.',
}
