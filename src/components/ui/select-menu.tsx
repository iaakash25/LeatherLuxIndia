import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * The shop's dropdowns. They replace the browser's built-in <select> and <datalist>, which look different on every device and cannot be
 * styled: the menu floats under its trigger, fades and slides in, marks the chosen option with a check, lights the option under the
 * pointer or the arrow keys, and (for long lists) has a search box. Keyboard and screen readers work as for a native select: arrows,
 * Home/End, Enter, Escape, and typing to jump (or to filter, in a searchable list).
 *
 *  - Select: choose one of the options.
 *  - Combobox: a text box with suggestions, for a field where the answer may also be something new (a category).
 *
 * The look is in styles.css (`.menu-panel`, `.menu-item`); the motion respects prefers-reduced-motion there.
 */
export type SelectOption<V extends string = string> = { value: V; label: string; /** quiet text at the right, e.g. a count */ meta?: string; /** a second line under the label */ hint?: string; disabled?: boolean };

type Shared<V extends string> = {
  options: SelectOption<V>[];
  value: V;
  onChange: (value: V) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  /** Class names for the floating menu (its width, mostly). */
  menuClassName?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean | undefined;
  "aria-describedby"?: string | undefined;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** The list of options, shared by both components: rows, highlight, check mark, empty message. */
function Options<V extends string>({ listId, items, active, selected, onPick, onHover, empty, query }: {
  listId: string; items: SelectOption<V>[]; active: number; selected: V | undefined; onPick: (o: SelectOption<V>) => void; onHover: (i: number) => void; empty: string; query?: string;
}) {
  if (!items.length) return <p className="px-4 py-6 text-center text-[13px] text-muted-foreground" role="status">{empty}</p>;
  return (
    <>
      {items.map((o, i) => {
        const isSelected = o.value === selected;
        return (
          <li
            key={o.value} id={`${listId}-${i}`} role="option" aria-selected={isSelected} aria-disabled={o.disabled || undefined} data-active={i === active || undefined} data-selected={isSelected || undefined}
            className="menu-item" style={{ ["--i" as string]: Math.min(i, 9) }}
            // mouse-down is kept from moving focus away from the search box or the trigger
            onMouseDown={(e) => e.preventDefault()} onMouseMove={() => onHover(i)} onClick={() => { if (!o.disabled) onPick(o); }}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{highlight(o.label, query)}</span>
              {o.hint && <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{o.hint}</span>}
            </span>
            {o.meta && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.meta}</span>}
            <Check className="menu-check h-4 w-4 shrink-0 stroke-[1.6]" aria-hidden="true" />
          </li>
        );
      })}
    </>
  );
}

/** Bolds the part of an option that matches what was typed. */
function highlight(label: string, query?: string) {
  const q = query?.trim();
  if (!q) return label;
  const at = norm(label).indexOf(norm(q));
  if (at < 0) return label;
  return <>{label.slice(0, at)}<mark className="bg-transparent font-medium text-ink underline decoration-oxblood/50 underline-offset-[3px]">{label.slice(at, at + q.length)}</mark>{label.slice(at + q.length)}</>;
}

function stepFrom<V extends string>(items: SelectOption<V>[], from: number, dir: 1 | -1): number {
  if (!items.length) return -1;
  for (let n = 1; n <= items.length; n++) {
    const i = (from + dir * n + items.length * (n + 1)) % items.length;
    if (!items[i]!.disabled) return i;
  }
  return from;
}
const firstEnabled = <V extends string>(items: SelectOption<V>[]) => items.findIndex((o) => !o.disabled);

// ─────────────────────────────── Select ───────────────────────────────
export function Select<V extends string>({
  options, value, onChange, id, disabled, className, menuClassName, placeholder = "Choose…", searchable = "auto", size = "md", variant = "field", align = "start", prefix, ...aria
}: Shared<V> & {
  placeholder?: string;
  /** A search box inside the menu. "auto" adds one for lists of more than 8. */
  searchable?: boolean | "auto";
  size?: "md" | "sm";
  /** "field" looks like the other form fields; "text" is a quiet inline control, like the sort control. */
  variant?: "field" | "text";
  align?: "start" | "end";
  /** Quiet text before the chosen label in the trigger, e.g. "Sort:". */
  prefix?: string;
}) {
  const auto = useId();
  const listId = `${id ?? auto}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const search = searchable === "auto" ? options.length > 8 : searchable;
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const items = useMemo(() => (search && query.trim() ? options.filter((o) => norm(o.label).includes(norm(query.trim()))) : options), [options, query, search]);
  const current = options.find((o) => o.value === value);

  const show = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      const at = options.findIndex((o) => o.value === value);
      setActive(at >= 0 ? at : firstEnabled(options));
    }
  }, [options, value]);

  // keep the highlighted row in view while arrowing through a long list
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);
  // typing in the search box narrows the list, so start at its first row
  useEffect(() => { if (open && search) setActive(firstEnabled(items)); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: SelectOption<V>) => { onChange(o.value); setOpen(false); };

  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowDown") { e.preventDefault(); setActive((a) => stepFrom(items, a, 1)); }
    else if (k === "ArrowUp") { e.preventDefault(); setActive((a) => stepFrom(items, a, -1)); }
    else if (k === "Home") { e.preventDefault(); setActive(firstEnabled(items)); }
    else if (k === "End") { e.preventDefault(); setActive(stepFrom(items, 0, -1)); }
    else if (k === "PageDown") { e.preventDefault(); setActive(Math.min(items.length - 1, active + 5)); }
    else if (k === "PageUp") { e.preventDefault(); setActive(Math.max(0, active - 5)); }
    else if (k === "Enter" || (k === " " && !search)) { e.preventDefault(); const o = items[active]; if (o && !o.disabled) pick(o); }
    else if (k === "Tab") setOpen(false);
    else if (!search && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // type-ahead: "be" jumps to "Belts"; the same letter again steps through the options that start with it
      const now = Date.now();
      typed.current = { text: now - typed.current.at > 700 ? k : typed.current.text + k, at: now };
      const t = norm(typed.current.text);
      const from = typed.current.text.length === 1 ? active : active - 1;
      for (let n = 1; n <= items.length; n++) {
        const i = (from + n + items.length) % items.length;
        if (!items[i]!.disabled && norm(items[i]!.label).startsWith(t)) { setActive(i); break; }
      }
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={(o) => (o ? show(true) : setOpen(false))}>
      <Popover.Trigger asChild>
        <button
          type="button" id={id} role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? listId : undefined} disabled={disabled} {...aria}
          onKeyDown={(e) => { if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) { e.preventDefault(); show(true); } }}
          className={cn(
            "menu-trigger group/trigger inline-flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50",
            variant === "field"
              ? cn("field justify-between aria-[invalid=true]:border-destructive data-[state=open]:border-ink", size === "sm" && "!h-9 !px-2.5 text-xs")
              : "text-[13px] hover:text-oxblood data-[state=open]:text-oxblood",
            className,
          )}
        >
          <span className={cn("min-w-0 truncate", !current && "text-muted-foreground")}>
            {prefix && <span className="text-muted-foreground max-sm:hidden">{prefix} </span>}
            {current?.label ?? placeholder}
          </span>
          <ChevronDown className={cn("shrink-0 stroke-[1.4] text-muted-foreground transition-transform duration-300 ease-lux group-data-[state=open]/trigger:rotate-180", size === "sm" || variant === "text" ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          role="presentation" side="bottom" align={align} sideOffset={6} collisionPadding={12} className={cn("menu-panel", menuClassName)}
          onOpenAutoFocus={(e) => { e.preventDefault(); (searchRef.current ?? listRef.current)?.focus({ preventScroll: true }); }}
          onKeyDown={onKeyDown}
        >
          {search && (
            <div className="flex items-center gap-2 border-b border-hairline px-3.5">
              <Search className="h-3.5 w-3.5 shrink-0 stroke-[1.5] text-muted-foreground" aria-hidden="true" />
              <input
                ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" aria-label="Search the options" autoComplete="off" spellCheck={false}
                role="searchbox" aria-controls={listId} aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
                className="h-11 w-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <ul ref={listRef} id={listId} role="listbox" tabIndex={-1} aria-label={aria["aria-label"]} aria-activedescendant={items.length ? `${listId}-${active}` : undefined} className="menu-list">
            <Options listId={listId} items={items} active={active} selected={value} onPick={pick} onHover={setActive} empty="Nothing matches" query={search ? query : ""} />
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─────────────────────────────── Combobox ───────────────────────────────
export function Combobox({
  options, value, onChange, id, disabled, className, menuClassName, placeholder, maxLength, ...aria
}: Omit<Shared<string>, "options"> & { options: SelectOption[]; placeholder?: string; maxLength?: number }) {
  const auto = useId();
  const listId = `${id ?? auto}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // nothing is highlighted until the arrow keys are used, so Enter never replaces what was typed
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const q = norm(value.trim());
    const list = q ? options.filter((o) => norm(o.label).includes(norm(q))) : options;
    // Once the text is exactly one of the options there is nothing left to suggest.
    return list.length === 1 && norm(list[0]!.label) === q ? [] : list;
  }, [options, value]);

  useEffect(() => { setActive(-1); }, [value]);
  useEffect(() => { if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [open, active, listId]);

  const pick = (o: SelectOption) => { onChange(o.value); setOpen(false); };
  const shown = open && items.length > 0;

  return (
    <Popover.Root open={shown} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative">
          <input
            ref={input} id={id} value={value} maxLength={maxLength} placeholder={placeholder} disabled={disabled} autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded={shown} aria-autocomplete="list" aria-controls={shown ? listId : undefined} aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined} {...aria}
            className={cn("field pr-10 aria-[invalid=true]:border-destructive", className)}
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); if (!shown) setOpen(true); setActive((a) => stepFrom(items, a, 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); if (shown) setActive((a) => (a <= 0 ? items.length - 1 : stepFrom(items, a, -1))); }
              else if (e.key === "Enter" && shown && active >= 0) { e.preventDefault(); const o = items[active]; if (o && !o.disabled) pick(o); }
              else if (e.key === "Escape" && shown) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
              else if (e.key === "Tab") setOpen(false);
            }}
          />
          <button type="button" tabIndex={-1} aria-label="Show suggestions" disabled={disabled} onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setOpen((o) => !o); input.current?.focus(); }} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-ink">
            <ChevronDown className={cn("h-4 w-4 stroke-[1.4] transition-transform duration-300 ease-lux", shown && "rotate-180")} aria-hidden="true" />
          </button>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          role="presentation" side="bottom" align="start" sideOffset={6} collisionPadding={12} className={cn("menu-panel", menuClassName)}
          // focus stays in the text box, so typing carries on while the suggestions narrow
          onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => { if (input.current?.parentElement?.contains(e.target as Node)) e.preventDefault(); }}
        >
          <ul id={listId} role="listbox" aria-label={aria["aria-label"]} className="menu-list">
            <Options listId={listId} items={items} active={active} selected={value} onPick={pick} onHover={setActive} empty="" query={value} />
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
