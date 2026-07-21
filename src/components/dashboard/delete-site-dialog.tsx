import { DeleteResource } from "@cloudflare/kumo"
import { useState } from "react"

interface DeleteSiteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string
  siteName: string
  onDeleted: (siteId: string) => void | Promise<void>
}

export function DeleteSiteDialog({
  open,
  onOpenChange,
  siteId,
  siteName,
  onDeleted,
}: DeleteSiteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | undefined>()

  function setOpen(nextOpen: boolean) {
    if (!nextOpen) setError(undefined)
    onOpenChange(nextOpen)
  }

  async function deleteSite() {
    setIsDeleting(true)
    setError(undefined)
    try {
      const response = await fetch(`/api/sites/${siteId}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? `Request failed: ${response.status}`)
      }

      await onDeleted(siteId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <DeleteResource
      open={open}
      onOpenChange={setOpen}
      resourceType="site"
      resourceName={siteName}
      deleteButtonText="Delete"
      onDelete={deleteSite}
      isDeleting={isDeleting}
      errorMessage={error}
    />
  )
}
