import { Button } from "@cloudflare/kumo/components/button"
import { Dialog } from "@cloudflare/kumo/components/dialog"
import { Input } from "@cloudflare/kumo/components/input"
import { PlusIcon } from "@phosphor-icons/react"
import { useState } from "react"

interface AddSiteDialogProps {
  onCreated: (siteId: string) => void
}

export function AddSiteDialog({ onCreated }: AddSiteDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [domain, setDomain] = useState("")
  const [timezone, setTimezone] = useState("UTC")
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setIsPending(true)
    setError(null)
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, domain, timezone: timezone || "UTC" }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? `Request failed: ${res.status}`)
      }
      const created = (await res.json()) as { id: string }
      setOpen(false)
      setName("")
      setDomain("")
      setTimezone("UTC")
      onCreated(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="primary"
            icon={PlusIcon}
            size="sm"
            shape="circle"
            aria-label="Add site"
          />
        )}
      />
      <Dialog className="p-4">
        <Dialog.Title className="mb-4 text-lg font-semibold">
          Add a site
        </Dialog.Title>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label="Name"
            placeholder="My blog"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            label="Domain"
            placeholder="example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
          <Input
            label="Timezone"
            placeholder="UTC"
            description="IANA timezone, e.g. America/New_York"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
          {error ? <p className="text-xs text-kumo-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Dialog.Close
              render={(closeProps) => (
                <Button
                  {...closeProps}
                  variant="secondary"
                  type="button"
                  aria-label="Cancel"
                  size="sm"
                >
                  Cancel
                </Button>
              )}
            />
            <Button
              type="submit"
              variant="primary"
              loading={isPending}
              disabled={isPending}
              size="sm"
            >
              Create site
            </Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  )
}
