import { Button } from "@cloudflare/kumo/components/button"
import { ClipboardText } from "@cloudflare/kumo/components/clipboard-text"
import { Dialog } from "@cloudflare/kumo/components/dialog"

interface InstallScriptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string
  siteName: string
  trackerOrigin: string
}

export function InstallScriptDialog({
  open,
  onOpenChange,
  siteId,
  siteName,
  trackerOrigin,
}: InstallScriptDialogProps) {
  const snippet = `<script defer src="${trackerOrigin}/script.js" data-site="${siteId}"></script>`

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size="lg" className="p-4">
        <p className="font-semibold">Install analytics on {siteName}</p>
        <p className="mt-2 mb-5 text-sm text-kumo-subtle">
          Add this script to every page you want to track, ideally before the
          closing body tag.
        </p>
        <ClipboardText
          text={snippet}
          textToCopy={snippet}
          tooltip={{ text: "Copy script", copiedText: "Script copied" }}
        />
        <div className="mt-5 flex justify-end">
          <Dialog.Close
            render={(closeProps) => (
              <Button {...closeProps} variant="primary">
                Done
              </Button>
            )}
          />
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
