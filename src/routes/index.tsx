import { createFileRoute, useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { desc } from "drizzle-orm"
import { db } from "@/db"
import { items } from "@/db/schema"

/**
 * Server function example.
 *
 * `createServerFn` is a typed RPC between client and server, called as
 * `getItems()` from anywhere (loader, event handler, effect). It runs
 * on the Worker.
 *
 * Prefer server functions for:
 *  - data this app's own UI consumes
 *  - end-to-end typed payloads (no hand-written fetch)
 *
 * Prefer API routes (see src/routes/api/items.ts) for:
 *  - external/3rd-party HTTP callers (curl, mobile, webhooks)
 *  - things that need a stable URL + verb
 */
const getItems = createServerFn().handler(async () => {
  return await db.select().from(items).orderBy(desc(items.createdAt)).all()
})

export const Route = createFileRoute("/")({
  loader: () => getItems(),
  component: App,
})

function App() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addItem() {
    setIsPending(true)
    setError(null)
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `Item ${new Date().toLocaleTimeString()}`,
          description: "Created from the home page",
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? `Request failed: ${res.status}`)
      }
      // Refresh the loader so the new item shows up.
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="flex min-h-svh p-6">
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">TanStack Start + Cloudflare Workers</h1>
          <p>
            D1 + Drizzle is wired up. {data.length} item(s) in the database.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-medium">Try it:</p>
          <pre className="rounded bg-gray-100 p-2 text-xs dark:bg-gray-800">
            {`# read
curl http://localhost:3000/api/items

# write
curl -X POST http://localhost:3000/api/items \\
  -H 'content-type: application/json' \\
  -d '{"title":"hello","description":"world"}'`}
          </pre>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={addItem}
              disabled={isPending}
              loading={isPending}
            >
              {isPending ? "Adding..." : "Add item to D1"}
            </Button>
          </div>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>

        {data.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {data.map((item) => (
              <li key={item.id} className="border-b py-1">
                <span className="font-medium">{item.title}</span>
                {item.description ? (
                  <span className="text-gray-500"> — {item.description}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500">
            No items yet. Click the button above to add one.
          </p>
        )}
      </div>
    </div>
  )
}
