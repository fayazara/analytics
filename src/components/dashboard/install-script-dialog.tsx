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
      <Dialog className="min-w-0 overflow-visible bg-transparent p-0 shadow-none ring-0 sm:w-150">
        <div className="flex max-h-[calc(100vh-32px)] w-full flex-col overflow-hidden rounded-xl bg-kumo-elevated text-base text-kumo-default ring ring-kumo-line">
          <header className="px-4 py-3">
            <Dialog.Title className="text-lg font-medium text-pretty text-kumo-default">
              Install analytics on {siteName}
            </Dialog.Title>
          </header>
          <div className="relative flex grow flex-col gap-2 overflow-hidden rounded-lg bg-kumo-base p-0 text-inherit ring ring-kumo-fill">
            <div className="grid grow gap-4 overflow-y-auto p-4">
              <p className="text-sm text-kumo-subtle">
                Add this script to every page you want to track, ideally before
                the closing body tag.
              </p>
              <ClipboardText
                text={snippet}
                textToCopy={snippet}
                tooltip={{ text: "Copy script", copiedText: "Script copied" }}
              />
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-kumo-line p-4">
              <Dialog.Close
                render={(closeProps) => (
                  <Button {...closeProps} variant="primary">
                    Done
                  </Button>
                )}
              />
            </footer>
          </div>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
