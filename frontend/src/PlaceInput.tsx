import { useEffect, useId, useRef, useState } from "react";
import { MapPin, LoaderCircle } from "lucide-react";
import type { Place } from "./types";
import { api } from "./lib";

export default function PlaceInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState(value?.name || "");
  const [options, setOptions] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (value) setQuery(value.name);
  }, [value]);
  useEffect(() => {
    if (!open || query.trim().length < 2 || query === value?.name) {
      setOptions([]);
      return;
    }
    setOptions([]);
    setActive(-1);
    setError("");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setError("");
      setActive(-1);
      api<{ places: Place[] }>(
        `/api/places?q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      )
        .then((data) => {
          setOptions(data.places);
          if (!data.places.length)
            setError("No cities found. Try a nearby city.");
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
      setBusy(false);
    };
  }, [query, open, value]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const choose = (p: Place) => {
    onChange(p);
    setQuery(p.name);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="place-field" ref={root}>
      <label htmlFor={id}>{label}</label>
      <div className="input-icon">
        <MapPin size={15} />
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && options.length > 0}
          aria-controls={`${id}-options`}
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          autoComplete="off"
          placeholder="Search a city"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(null);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, options.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
            if (e.key === "Enter" && open && active >= 0 && options[active]) {
              e.preventDefault();
              choose(options[active]);
            }
          }}
        />
        {busy && <LoaderCircle size={14} className="spin" />}
      </div>
      {open && (options.length > 0 || error) && (
        <div className="suggestions">
          <ul
            id={`${id}-options`}
            role="listbox"
            aria-label={`${label} cities`}
          >
            {options.map((p, i) => (
              <li
                role="option"
                id={`${id}-${i}`}
                aria-selected={active === i}
                key={`${p.latitude}-${p.longitude}`}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  className={active === i ? "active" : ""}
                  onClick={() => choose(p)}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
          {error && <p role="status">{error}</p>}
        </div>
      )}
    </div>
  );
}
