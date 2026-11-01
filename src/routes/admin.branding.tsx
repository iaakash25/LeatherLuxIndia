import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Field, fieldErrors, Section } from "@/components/admin/ui";
import { api, errorMessage } from "@/lib/api";
import { brandTitle, useBrand } from "@/lib/brand";

export const Route = createFileRoute("/admin/branding")({ component: Branding });

type BrandingReply = { branding: { siteName: string; siteSubtitle: string; logoUrl: string | null } };
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_LOGO_BYTES = 1024 * 1024;

function Branding() {
  const brand = useBrand();
  const router = useRouter();
  const [name, setName] = useState(brand.siteName);
  const [subtitle, setSubtitle] = useState(brand.siteSubtitle);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = name.trim() !== brand.siteName || subtitle.trim() !== brand.siteSubtitle;
  const preview = { siteName: name.trim() || brand.siteName, siteSubtitle: subtitle.trim(), logoUrl: brand.logoUrl };

  // The root loader holds the brand every page reads; invalidating it refreshes header, footer and titles at once.
  const refresh = () => router.invalidate();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setErrors({}); setFormError("");
    try {
      await api<BrandingReply>("/admin/branding", { method: "PUT", body: { siteName: name, siteSubtitle: subtitle } });
      await refresh();
      toast.success("Name saved");
    } catch (err) {
      const f = fieldErrors(err);
      setErrors(f.fields); setFormError(f.general);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setLogoError("");
    if (!LOGO_TYPES.includes(file.type)) { setLogoError("Please choose a PNG, JPEG or WebP image."); return; }
    if (file.size > MAX_LOGO_BYTES) { setLogoError("That image is over 1 MB. Please use a smaller file."); return; }
    setLogoBusy(true);
    try {
      await api<BrandingReply>("/admin/branding/logo", { method: "PUT", file });
      await refresh();
      toast.success("Logo updated");
    } catch (err) {
      setLogoError(errorMessage(err));
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true); setLogoError("");
    try {
      await api<BrandingReply>("/admin/branding/logo", { method: "DELETE" });
      await refresh();
      toast("Logo removed");
    } catch (err) {
      setLogoError(errorMessage(err));
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <Section title="Store name" hint="Shown in the header, footer, browser tab and page titles. The subtitle is the small line under the name — leave it empty to hide it.">
        <form onSubmit={save} noValidate className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Field id="siteName" label="Name" error={errors["siteName"]}>
            <input id="siteName" className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors["siteName"]} aria-describedby="siteName-err" />
          </Field>
          <Field id="siteSubtitle" label="Subtitle (optional)" error={errors["siteSubtitle"]}>
            <input id="siteSubtitle" className="field" value={subtitle} maxLength={40} onChange={(e) => setSubtitle(e.target.value)} aria-invalid={!!errors["siteSubtitle"]} aria-describedby="siteSubtitle-err" />
          </Field>
          <div className="sm:col-span-2">
            <p className="min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{formError}</p>
            <button type="submit" disabled={saving || !dirty} className="btn-ink mt-2">{saving ? "Saving…" : "Save name"}</button>
          </div>
        </form>

        <div className="mt-8">
          <p className="eyebrow text-muted-foreground">Preview</p>
          <div className="mt-3 flex h-24 items-center justify-center border border-hairline bg-chalk">
            {preview.logoUrl ? (
              <img src={preview.logoUrl} alt={brandTitle(preview)} className="h-11 w-auto max-w-[260px] object-contain" />
            ) : (
              <div className="flex flex-col items-center leading-none">
                <span className="font-display text-[26px] tracking-[0.2em] uppercase">{preview.siteName}</span>
                {preview.siteSubtitle && <span className="mt-1 text-[8.5px] tracking-[0.6em] text-muted-foreground uppercase">{preview.siteSubtitle}</span>}
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Logo" hint="PNG, JPEG or WebP, up to 1 MB. A wide image with a transparent background works best. When a logo is set it replaces the text name in the header; the name stays in the tab title and page text.">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex h-24 w-64 items-center justify-center border border-hairline bg-chalk">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="Current logo" className="max-h-20 max-w-[15rem] object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">No logo — the name is shown as text</span>
            )}
          </div>
          <div className="space-y-3">
            <input ref={fileRef} id="logo-file" type="file" accept={LOGO_TYPES.join(",")} className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} disabled={logoBusy} />
            <label htmlFor="logo-file" className={`btn-ink cursor-pointer ${logoBusy ? "pointer-events-none opacity-40" : ""}`}>{logoBusy ? "Working…" : brand.logoUrl ? "Replace logo" : "Upload logo"}</label>
            {brand.logoUrl && (
              <div>
                <button type="button" onClick={() => void removeLogo()} disabled={logoBusy} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-oxblood disabled:opacity-40">Remove logo</button>
              </div>
            )}
          </div>
        </div>
        <p className="mt-4 min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{logoError}</p>
      </Section>
    </div>
  );
}
