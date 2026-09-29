import { useQuery } from "@tanstack/react-query";
import { core } from "./queries";
import type { Attachment, AttachmentPreview } from "../../core/attachments";
import { Button } from "./components/button";
import { PaperclipIcon, XIcon } from "./components/icons";
import { cn, divider, muted } from "./components/styles";

export const draftAttachmentPreviews = (attachments: Attachment[]): AttachmentPreview[] =>
  attachments.map(({ id, name, size, mimeType, content }) => ({
    id,
    name,
    size,
    mimeType,
    type: content.type,
    ...(content.type === "image" && { image: `data:${mimeType};base64,${content.data}` }),
  }));

function AttachmentImage({ attachment: a }: { attachment: AttachmentPreview }) {
  const preview = useQuery({
    ...core("attachmentImage", a.bundleId ?? "", a.id),
    enabled: !!a.bundleId,
    staleTime: Infinity,
  });
  const src = a.image ?? preview.data;
  return src ? (
    <img src={src} alt={a.name} className="size-14 rounded object-contain" />
  ) : (
    <span className="flex size-14 items-center justify-center">
      <PaperclipIcon />
    </span>
  );
}

export function Attachments({
  attachments,
  onRemove,
}: {
  attachments: AttachmentPreview[];
  onRemove?: (id: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div
      className="flex max-h-44 flex-wrap items-start gap-1.5 overflow-y-auto p-2"
      aria-label="Attachments"
    >
      {attachments.map((a) => (
        <div
          key={a.id}
          title={`${a.name} · ${Math.max(1, Math.ceil(a.size / 1024))} KB${a.type === "file" ? " · Local file reference" : ""}`}
          className={cn(
            "relative flex max-w-full items-center gap-1.5 rounded-md border p-1.5 text-xs",
            divider,
          )}
        >
          {a.type === "image" ? <AttachmentImage attachment={a} /> : <PaperclipIcon />}
          <span className="max-w-36 truncate">{a.name}</span>
          {onRemove && (
            <Button
              variant="ghost"
              className={cn("p-1", muted)}
              title={`Remove ${a.name}`}
              aria-label={`Remove ${a.name}`}
              onClick={() => onRemove(a.id)}
            >
              <XIcon />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
