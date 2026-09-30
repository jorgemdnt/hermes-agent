import { FileUp, X } from "lucide-react";

interface ComposerAttachmentsProps {
  photos: Array<{ file: File; preview: string }>;
  files: File[];
  status?: Record<string, string>;
  onRemovePhoto: (index: number) => void;
  onRemoveFile: (index: number) => void;
}

export function ComposerAttachments({ photos, files, status, onRemovePhoto, onRemoveFile }: ComposerAttachmentsProps) {
  const attachments = [
    ...photos.map((photo, index) => ({ ...photo, key: `photo:${index}`, remove: () => onRemovePhoto(index) })),
    ...files.map((file, index) => ({ file, preview: "", key: `file:${index}`, remove: () => onRemoveFile(index) })),
  ];
  if (!attachments.length) return null;
  return <div className="m-attachment-previews" aria-label="Selected attachments">
    {attachments.map(attachment => <div className={`m-attachment-chip${attachment.preview ? " m-photo-preview" : " m-file-preview"}`} key={attachment.key}>
      {attachment.preview ? <img src={attachment.preview} alt={attachment.file.name} /> : <span className="m-attachment-icon"><FileUp size={20} aria-hidden="true" /></span>}
      <span className="m-attachment-label"><span title={attachment.file.name}>{attachment.file.name}</span><small>{Math.ceil(attachment.file.size / 1024)} KB{status?.[attachment.key] && <span role="status"> · {status[attachment.key]}</span>}</small></span>
      <button type="button" aria-label={`Remove ${attachment.file.name}`} onClick={attachment.remove}><X size={15} aria-hidden="true" /></button>
    </div>)}
  </div>;
}
