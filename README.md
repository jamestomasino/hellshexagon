# Hells Hexagon

I want to create a web app that will be for the game titled Hell's Hexagon. This game is built upon the rules of The Six Degrees of Kevin Bacon. In this game, 3 films are chosen, and three actors or actresses. Each film connects to the other by connecting through one of the three actors. This creates a hexagon shape in a complete ring. The players have a maximum of 36 actors they can use to complete the ring, and no Actors or Films can be repeated.

We are going to make this a web app. I want to be able to auto-complete the names of actors and films, probably by pulling from an api like IMDB. I would also like the ability to randomly generate the starting films & actors for the the hexagon. I would also like this app to have "rooms" of sessions where multiple users can connect and play in real-time with one another.

# Stack & Hosting

* **Framework:** Nuxt 3 (Nitro) + TypeScript.
* **Deploy:** Netlify adapter (server routes become Netlify Functions).
* **DB:** Postgres (Neon or Supabase). Prisma for schema/migrations.
* **Cache/Rate limit:** Netlify KV (or Upstash Redis REST if you prefer).
* **Realtime rooms:** Use **Ably** or **Pusher** channels (Netlify Functions don’t keep native WebSockets reliably; SSE works but pub/sub is simpler and battle-tested).

# High-level architecture

* **Nuxt pages**: UI for lobby, room, results.
* **Nitro server routes**: `/server/api/*` → Netlify Functions.
* **TMDb proxy**: server endpoints call TMDb, add caching & disambiguation.
* **Room state**: persisted in Postgres; transient edges/caches in KV.
* **Realtime**: room messages via Ably channels: `hellshex:<roomId>`.

# Directory layout

```
app/
  pages/
    index.vue
    room/[code].vue
  components/
    HexBoard.vue
    EntityInput.vue
    RoomSidebar.vue
    ShareCard.vue
  composables/
    useRoom.ts
    useSearch.ts
  server/
    api/
      search/
        movie.get.ts
        person.get.ts
      movie/
        [id]/
          credits.get.ts
      rooms.post.ts           // create room
      rooms/[id].get.ts       // snapshot
      rooms/[id]/start.post.ts
      rooms/[id]/move.post.ts
  prisma/
    schema.prisma
  plugins/
    ably.client.ts
  nuxt.config.ts
netlify.toml
```

# Env & config

```
# .env
TMDB_TOKEN=...               # v4 bearer
DATABASE_URL=...             # Neon/Supabase
ABLY_API_KEY=...             # or PUSHER_*
NUXT_KV_NAMESPACE=hexagon    # if using Netlify KV
SEED_POOL_SIZE=200
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@pinia/nuxt'],
  nitro: { preset: 'netlify' }, // deploy to Netlify Functions
  runtimeConfig: {
    tmdbToken: process.env.TMDB_TOKEN,
    ablyKey: process.env.ABLY_API_KEY,
    databaseUrl: process.env.DATABASE_URL,
    seedPoolSize: process.env.SEED_POOL_SIZE || '200',
    public: {
      ablyKeyPublic: process.env.ABLY_API_KEY?.split(':')[0] ?? '' // if using Ably Token Requests, expose only key name
    }
  },
  typescript: { strict: true }
})
```

# Prisma schema (core tables)

```prisma
// prisma/schema.prisma
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

model User {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  Roster    Roster[]
  Move      Move[]
}

model Room {
  id        String   @id @default(cuid())
  code      String   @unique
  status    RoomStatus @default(lobby)
  seedId    String?
  maxActors Int      @default(36)
  createdAt DateTime @default(now())
  Roster    Roster[]
  Move      Move[]
  Seed      Seed?    @relation(fields: [seedId], references: [id])
}

enum RoomStatus { lobby active complete }

model Seed {
  id   String @id @default(cuid())
  f1Id Int
  a1Id Int
  f2Id Int
  a2Id Int
  f3Id Int
  a3Id Int
  f1   String
  a1   String
  f2   String
  a2   String
  f3   String
  a3   String
}

model Move {
  id        String   @id @default(cuid())
  roomId    String
  userId    String
  slot      Slot
  entityId  Int
  entityTyp EntityType
  name      String
  createdAt DateTime @default(now())
  Room      Room     @relation(fields: [roomId], references: [id])
  User      User     @relation(fields: [userId], references: [id])
}

model Roster {
  roomId String
  userId String
  role   Role
  Room   Room @relation(fields: [roomId], references: [id])
  User   User @relation(fields: [userId], references: [id])
  @@id([roomId, userId])
}

enum Slot { F1 A1 F2 A2 F3 A3 }
enum Role { host player spectator }
enum EntityType { film actor }
```

# TMDb proxy endpoints (Netlify Functions via Nitro)

```ts
// server/api/search/movie.get.ts
export default defineEventHandler(async (event) => {
  const q = getQuery(event).q as string || ''
  if (q.length < 2) return { results: [] }
  const { tmdbToken } = useRuntimeConfig()
  const r = await $fetch<any>('https://api.themoviedb.org/3/search/movie', {
    headers: { Authorization: `Bearer ${tmdbToken}` },
    query: { query: q, include_adult: false, page: 1 }
  })
  const results = (r.results ?? []).map((m: any) => ({
    id: m.id, type: 'film', title: m.title,
    year: (m.release_date || '').slice(0, 4),
    poster: m.poster_path
  }))
  return { results }
})

// server/api/search/person.get.ts
export default defineEventHandler(async (event) => {
  const q = getQuery(event).q as string || ''
  if (q.length < 2) return { results: [] }
  const { tmdbToken } = useRuntimeConfig()
  const r = await $fetch<any>('https://api.themoviedb.org/3/search/person', {
    headers: { Authorization: `Bearer ${tmdbToken}` },
    query: { query: q, page: 1 }
  })
  const results = (r.results ?? []).map((p: any) => ({
    id: p.id, type: 'actor', name: p.name, headshot: p.profile_path
  }))
  return { results }
})

// server/api/movie/[id]/credits.get.ts
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  const { tmdbToken } = useRuntimeConfig()
  // KV cache (pseudo-code)
  const kv = useStorage('kv:hexagon') // Netlify KV binding via Nitro storage
  const key = `movie:${id}:credits`
  const cached = await kv.getItem<any>(key)
  if (cached) return cached
  const data = await $fetch<any>(`https://api.themoviedb.org/3/movie/${id}/credits`, {
    headers: { Authorization: `Bearer ${tmdbToken}` }
  })
  const trimmed = { cast: data.cast?.map((c: any) => ({ id: c.id, name: c.name })) ?? [] }
  await kv.setItem(key, trimmed, { ttl: 60 * 60 * 24 })
  return trimmed
})
```

# Seed builder (solvable ring)

```ts
// server/utils/seedBuilder.ts
type Film = { id:number, title:string }
type Person = { id:number, name:string }

export async function buildSolvableSeed(): Promise<{
  f1:Film, a1:Person, f2:Film, a2:Person, f3:Film, a3:Person
}> {
  // pick F1 from a curated pool to avoid extreme obscurities
  const f1 = await pickPopularFilm()
  const a1 = await pickRandomCastMember(f1.id)
  const f2 = await pickOtherFilmByActor(a1.id, [f1.id])
  const a2 = await pickRandomCastMemberExcluding(f2.id, [a1.id])
  const f3 = await pickOtherFilmByActor(a2.id, [f1.id, f2.id])
  const a3 = await findBridgeActor(f3.id, f1.id, [a1.id, a2.id])
  if (!a3) throw new Error('restart')
  return { f1, a1, f2, a2, f3, a3 }
}
```

# Room routes and validation

```ts
// server/api/rooms.post.ts
import { prisma } from '~/server/utils/db'
export default defineEventHandler(async (event) => {
  const body = await readBody<{ hostName:string, maxActors?:number }>(event)
  const code = await generateCode()
  const room = await prisma.room.create({
    data: { code, maxActors: body.maxActors ?? 36, status: 'lobby' }
  })
  return { id: room.id, code: room.code }
})

// server/api/rooms/[id]/start.post.ts
export default defineEventHandler(async (event) => {
  const { id } = event.context.params!
  const seed = await buildSolvableSeed()
  const saved = await prisma.seed.create({ data: {
    f1Id: seed.f1.id, a1Id: seed.a1.id, f2Id: seed.f2.id, a2Id: seed.a2.id, f3Id: seed.f3.id, a3Id: seed.a3.id,
    f1: seed.f1.title, a1: seed.a1.name, f2: seed.f2.title, a2: seed.a2.name, f3: seed.f3.title, a3: seed.a3.name
  }})
  await prisma.room.update({ where:{ id }, data:{ seedId: saved.id, status: 'active' }})
  // broadcast via Ably
  await publishRoom(id, { type:'started', seed: publicSeed(saved) })
  return { ok:true }
})

// server/api/rooms/[id]/move.post.ts
export default defineEventHandler(async (event) => {
  const { id } = event.context.params!
  const body = await readBody<{ slot:'F1'|'A1'|'F2'|'A2'|'F3'|'A3', entity:{ id:number, type:'film'|'actor', name:string } }>(event)
  // 1) type/dup checks
  const state = await getRoomState(id)
  if (isDuplicate(state, body.entity)) return sendError(event, createError({ statusCode:400, statusMessage:'Duplicate entity' }))
  if (!slotTypeOk(body.slot, body.entity.type)) return sendError(event, createError({ statusCode:400, statusMessage:'Wrong type for slot' }))

  // 2) neighbor link checks
  for (const neighbor of neighbors(body.slot)) {
    const n = state[neighbor]
    if (!n) continue
    const ok = await isActorInFilm(
      body.slot.startsWith('A') ? body.entity.id : n.id,
      body.slot.startsWith('F') ? body.entity.id : n.id
    )
    if (!ok) return sendError(event, createError({ statusCode:400, statusMessage:`No link between ${body.slot} and ${neighbor}` }))
  }

  // 3) commit and broadcast
  await prisma.move.create({ data: {
    roomId: id, userId: state.userId, slot: body.slot as any,
    entityId: body.entity.id, entityTyp: body.entity.type === 'film' ? 'film' : 'actor', name: body.entity.name
  }})
  const next = await getRoomState(id, true)
  await publishRoom(id, { type:'state', state: publicState(next) })
  if (isComplete(next)) await publishRoom(id, { type:'complete', summary: shareSummary(next) })
  return { ok:true }
})
```

Helper (credits check with cache):

```ts
async function isActorInFilm(actorId:number, filmId:number) {
  const { cast } = await $fetch<{ cast:{id:number}[] }>(`/api/movie/${filmId}/credits`)
  return cast.some(c => c.id === actorId)
}
```

# Realtime wiring with Ably

* **Server**: publish on moves/starts.
* **Client**: subscribe per room code, update Pinia store.

```ts
// plugins/ably.client.ts
import * as Ably from 'ably'
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const client = new Ably.Realtime({ key: config.public.ablyKeyPublic + ':' + (config.ablyKey ? 'token' : ''), echoMessages: false })
  return { provide: { ably: client } }
})

// composables/useRoom.ts
export function useRoom(code:string) {
  const { $ably } = useNuxtApp()
  const state = useState(`room:${code}`, () => ({ /* slots, players, chat */ }))
  let channel: any
  onMounted(() => {
    channel = $ably.channels.get(`hellshex:${code}`)
    channel.subscribe((msg:any) => {
      if (msg.data.type === 'state') state.value = msg.data.state
      if (msg.data.type === 'started') /* set seed */
      if (msg.data.type === 'complete') /* finish */
    })
  })
  onBeforeUnmount(() => channel && channel.detach())
  return { state }
}
```

# UI components

* **HexBoard.vue**: six slots arranged as a hex, each slot uses `EntityInput.vue`.
* **EntityInput.vue**:

  * Debounced text box.
  * Calls `/api/search/movie` or `/api/search/person`.
  * On select → POST `/api/rooms/:id/move`.
* **RoomSidebar.vue**: player list, chat, timer, remaining actor budget.

Example input:

```vue
<!-- components/EntityInput.vue -->
<script setup lang="ts">
const props = defineProps<{ type:'film'|'actor', slot:'F1'|'A1'|'F2'|'A2'|'F3'|'A3', roomId:string }>()
const q = ref('')
const results = ref<any[]>([])
const loading = ref(false)
watchDebounced(q, async (val) => {
  if (val.length < 2) { results.value = []; return }
  loading.value = true
  const path = props.type === 'film' ? '/api/search/movie' : '/api/search/person'
  const r = await $fetch<{results:any[]}>(path, { query:{ q: val }})
  results.value = r.results
  loading.value = false
}, { debounce: 250, maxWait: 500 })
async function choose(item:any) {
  await $fetch(`/api/rooms/${props.roomId}/move`, { method:'POST', body:{
    slot: props.slot, entity: props.type === 'film'
      ? { id:item.id, type:'film', name:item.title }
      : { id:item.id, type:'actor', name:item.name }
  }})
}
</script>
```

# Netlify specifics

**netlify.toml**

```toml
[build]
  command = "npx prisma generate && npx prisma migrate deploy && npx nuxt build"
  publish = ".output/public"

[functions]
  directory = ".netlify/functions"

[[plugins]]
  package = "@netlify/plugin-nextjs" # Nitro handles, but this keeps redirects tidy

[dev]
  command = "nuxi dev"
```

Notes:

* Nuxt Nitro’s Netlify preset emits serverless handlers into `.netlify/functions/`.
* Bind **Netlify KV** in your site settings and access via `useStorage('kv:<namespace>')`.
* Prefer **Neon** for Postgres with pooled connection strings suitable for serverless (e.g., `?sslmode=require` and PgBouncer/Neon pooler).
* For Ably, use **Token Requests** from a server route if you don’t want to expose key fragments.

# Seeding strategy

* Nightly Netlify Scheduled Function to prebuild a pool of solvable seeds by difficulty tiers and store in Postgres.
* On room start, pull from the pool to avoid bursty TMDb calls.

# Security & fairness

* Rate-limit search endpoints per IP/session via KV counters.
* Always validate on the server; never accept client links without checking credits.
* Disallow duplicate IDs across all six slots.
* Optional “fog mode” where the rejection reason is hidden.

# What you’ll get out of the box with this plan

* Fast Nuxt front end with smooth autocomplete.
* Fully server-validated ring logic.
* Reliable realtime via Ably channels for “rooms.”
* One-click Netlify deploy and scalable serverless functions.
* A path to production with observability and minimal ops.

If you want, I can generate:

1. the Prisma schema and seed migration,
2. the complete `server/api` handlers, and
3. a first-pass `HexBoard.vue` with the hex layout and inputs wired to moves.
