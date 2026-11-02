import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { PHOTO_ACCEPT, PhotoError, preparePhoto, uploadPhoto } from "@/lib/photo-upload";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Pill } from "./ui";

/** A photo that is already uploaded: the server's id, a small preview to show here, and what it shows. */
export type PhotoItem = { id: string; preview: string; label: string };

/**
 * Up to `max` photos for a new product. Each file is resized and (optionally) given the shop's off-white backdrop in the browser, then
 * uploaded the moment it is chosen; the form only keeps their ids. The first photo is the cover.
 */
export function PhotoUploader({ photos, onChange, max = 4, id }: { photos: PhotoItem[]; onChange: Dispatch<SetStateAction<PhotoItem[]>>; max?: number; id: string }) {
  const [pending, setPending] = useState<{ key: number; name: string }[]>([]);
  const [error, setError] = useState("");
  const [match, setMatch] = useState(true);
  const [holes, setHoles] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const room = max - photos.length - pending.length;

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const chosen = [...files];
    if (chosen.length > room) setError(`Only ${Math.max(room, 0)} more photo${room === 1 ? "" : "s"} fit (the most is ${max}). The rest were left out.`);
    for (const file of chosen.slice(0, Math.max(room, 0))) {
      const key = ++counter.current;
      setPending((p) => [...p, { key, name: file.name }]);
      try {
        const prepared = await preparePhoto(file, { matchBackdrop: match, holes: match && holes });
        const uploaded = await uploadPhoto(prepared);
        onChange((prev) => (prev.length >= max ? prev : [...prev, { id: uploaded.id, preview: prepared.preview, label: "" }]));
      } catch (e) {
        setError(e instanceof PhotoError ? e.message : errorMessage(e));
      } finally {
        setPending((p) => p.filter((x) => x.key !== key));
      }
    }
    if (input.current) input.current.value = "";
  };

  const move = (i: number, by: -1 | 1) => onChange((p) => { const n = [...p]; const j = i + by; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const remove = (i: number) => onChange((p) => { const gone = p[i]; if (gone) URL.revokeObjectURL(gone.preview); return p.filter((_, k) => k !== i); });
  const relabel = (i: number, label: string) => onChange((p) => p.map((x, k) => (k === i ? { ...x, label } : x)));

  return (
    <div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {photos.map((p, i) => (
          <li key={p.id} className="min-w-0">
            <div className="relative aspect-[4/5] overflow-hidden bg-chalk ring-1 ring-hairline">
              <img src={p.preview} alt={`Photo ${i + 1}${p.label ? `: ${p.label}` : ""}`} className="h-full w-full object-cover" />
              {i === 0 && <span className="absolute left-1.5 top-1.5"><Pill tone="live">Cover</Pill></span>}
            </div>
            <input className="field mt-2 h-9 px-2 text-xs" value={p.label} maxLength={40} placeholder={i === 0 ? "Front" : `View ${i + 1}`} aria-label={`What photo ${i + 1} shows`} onChange={(e) => relabel(i, e.target.value)} />
            <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11px]">
              <button type="button" disabled={i === 0} aria-label={`Move photo ${i + 1} earlier`} className="underline underline-offset-4 hover:text-oxblood disabled:no-underline disabled:opacity-30" onClick={() => move(i, -1)}>← Earlier</button>
              <button type="button" disabled={i === photos.length - 1} aria-label={`Move photo ${i + 1} later`} className="underline underline-offset-4 hover:text-oxblood disabled:no-underline disabled:opacity-30" onClick={() => move(i, 1)}>Later →</button>
              <button type="button" aria-label={`Remove photo ${i + 1}`} className="text-muted-foreground underline underline-offset-4 hover:text-oxblood" onClick={() => remove(i)}>Remove</button>
            </p>
          </li>
        ))}
        {pending.map((x) => (
          <li key={x.key} className="min-w-0" aria-live="polite">
            <div className="grid aspect-[4/5] place-items-center bg-chalk px-2 text-center text-xs text-muted-foreground ring-1 ring-hairline">Preparing {x.name}…</div>
          </li>
        ))}
        {room > 0 && (
          <li className="min-w-0">
            <button type="button" onClick={() => input.current?.click()} aria-describedby={`${id}-hint`}
              className={cn("grid aspect-[4/5] w-full place-items-center border border-dashed border-input bg-paper/60 px-3 text-center text-sm transition-colors hover:border-ink hover:bg-paper")}>
              <span>+ Add photo<span className="mt-1 block text-[11px] text-muted-foreground">{photos.length + pending.length} of {max}</span></span>
            </button>
          </li>
        )}
      </ul>
      <input ref={input} type="file" accept={PHOTO_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-label="Choose photos" onChange={(e) => void add(e.target.files)} />
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-ink" checked={match} onChange={(e) => setMatch(e.target.checked)} />
        <span>Match the shop's off-white backdrop<span className="mt-0.5 block text-xs text-muted-foreground">Recolours a white studio background, so the photo looks like the rest of the shop. Untick for photos taken on location. Applies to photos you add next.</span></span>
      </label>
      {match && (
        <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-ink" checked={holes} onChange={(e) => setHoles(e.target.checked)} />
          <span>Also recolour the white inside handles, buckles and key rings<span className="mt-0.5 block text-xs text-muted-foreground">Leave off for wallets and card holders, whose white parts (card slips, ID windows) are real.</span></span>
        </label>
      )}
      <p id={`${id}-hint`} className="mt-3 text-xs text-muted-foreground">1 to {max} photos (JPG, PNG or WebP). They are resized for you. The first is the cover shown on cards.</p>
      <p className="mt-2 min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
