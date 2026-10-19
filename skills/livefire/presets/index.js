// livefire — the preset REGISTRY the controller uses for auto-detect.
//
// Order matters: auto-detect returns the FIRST preset whose detect() matches, so list
// most-specific first (e.g. nestjs before express — NestJS runs on Express; supabase before a
// bare Node match; laravel before symfony). To add a stack: create presets/<stack>.js (copy
// TEMPLATE.js) and add it here in the right position. No rebuild per preset — livefire assembles
// ONE universal workflow; the controller resolves the adapter (src/detect.js) and passes it to
// the workflow at launch.

import { supabaseAdapter } from './supabase.js'
import { nextjsAdapter } from './nextjs.js'
import { nestjsAdapter } from './nestjs.js'
import { strapiAdapter } from './strapi.js'
import { firebaseAdapter } from './firebase.js'
import { expressAdapter } from './express.js'
import { djangoAdapter } from './django.js'
import { fastapiAdapter } from './fastapi.js'
import { flaskAdapter } from './flask.js'
import { railsAdapter } from './rails.js'
import { laravelAdapter } from './laravel.js'
import { symfonyAdapter } from './symfony.js'
import { springAdapter } from './spring.js'
import { aspnetAdapter } from './aspnet.js'
import { goAdapter } from './go.js'
import { hasuraAdapter } from './hasura.js'

export const REGISTRY = {
  // Family A (declarative in-DB) + opinionated Node — most specific first
  supabase: supabaseAdapter,
  nestjs: nestjsAdapter,     // before express — NestJS uses Express under the hood
  strapi: strapiAdapter,
  firebase: firebaseAdapter,
  hasura: hasuraAdapter,     // before nextjs — hasura metadata = the real authz even with a Next frontend
  nextjs: nextjsAdapter,     // Next without Supabase/Firebase/Hasura — before express (custom server)
  express: expressAdapter,   // bare Node/Express (excludes NestJS)
  // Python
  django: djangoAdapter,
  fastapi: fastapiAdapter,
  flask: flaskAdapter,
  // Ruby
  rails: railsAdapter,
  // PHP — laravel before symfony (artisan is unambiguous)
  laravel: laravelAdapter,
  symfony: symfonyAdapter,
  // JVM / .NET / Go
  spring: springAdapter,
  aspnet: aspnetAdapter,
  go: goAdapter,
}
