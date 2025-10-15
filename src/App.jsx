// path: snhu-map/src/App.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";


// Fix Leaflet marker icon loading in bundlers (Vite, CRA, etc.).
// Leaflet attempts to load marker assets from its own relative paths which often aren't
// available when bundlers rewrite/move files. Remove the default getter and provide
// explicit CDN URLs so markers render correctly in dev and production builds.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

/**
 * @typedef {{ id:string, lat:number, lng:number, title:string, years:string, notes:string, extra?:{ city?:string, displayName?:string }, createdAt:number }} Location
 */

/**
 * Validate that a parsed JSON value is an array of Location objects.
 * Returns [true, locations] on success or [false, errorMessage] on failure.
 * This performs a minimal shape check (id, lat, lng) and intentionally accepts
 * other optional fields if present.
 */
function validateLocationsJson(value) {
  if (!Array.isArray(value)) return [false, "File must contain an array."];
  const ok = value.every(
    (v) => v && typeof v.lat === "number" && typeof v.lng === "number" && typeof v.id === "string"
  );
  if (!ok) return [false, "Each item must include id (string), lat (number), lng (number)."];
  return [true, /** @type {Location[]} */ (value)];
}

/**
 * Trigger a browser download of the provided value serialized as JSON.
 * - filename: suggested filename
 * - data: JSON-serializable object
 * Side effects: creates a Blob, object URL, and a temporary anchor which is
 * programmatically clicked to start the download.
 */
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();

  URL.revokeObjectURL(url);
}

async function reverseGeocode(lat, lng) { 
  //self-note: reverse geocoding is converting coordinates to human-readable addresses

  /**
   * Reverse-geocode lat/lng using OpenStreetMap Nominatim.
   * Inputs: lat (number), lng (number)
   * Returns: { city?: string, displayName?: string }
   * Throws on non-OK HTTP responses.
   */
  const u = new URL("https://nominatim.openstreetmap.org/reverse");
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lon", String(lng));
  u.searchParams.set("zoom", "10");
  u.searchParams.set("addressdetails", "1");
  const res = await fetch(u.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Reverse geocoding failed: ${res.status}`);
  const json = await res.json();
  const city = json?.address?.city || json?.address?.town || json?.address?.village || json?.address?.county;
  return { city, displayName: json?.display_name };
}

function useLocalStorageState(key, initial) {
  // Hook for state that is persisted to localStorage.

  /**
   * Hook that behaves like useState but persists to localStorage.
   * - key: localStorage key
   * - initial: initial value or initializer function
   * Returns [state, setState]. Writes JSON to localStorage on changes.
   * Caveat: JSON.parse may throw if stored value is corrupted.
   */
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : (typeof initial === "function" ? initial() : initial);
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)); }, [key, state]);
  return [state, setState];
}

function CenterMap({ lat, lng }) {
  // Small helper component that recenters the map when lat/lng props change.
  // Props: { lat: number, lng: number }
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], Math.max(map.getZoom(), 6), { animate: true }); }, [lat, lng, map]);
  return null;
}

// Root app component: manages locations and UI state and renders map + panels
export default function App() {
  const [locations, setLocations] = useLocalStorageState("snhu.locations", /** @type {Location[]} */([]));
  const [mode, setMode] = useLocalStorageState("snhu.mode", "collecting"); // "collecting" | "done"
  const [showList, setShowList] = useLocalStorageState("snhu.showList", true);
  const [pendingClick, setPendingClick] = useState(null); // {lat,lng} | null
  const [editing, setEditing] = useState(null); // Location | null
  const [geocodeBusy, setGeocodeBusy] = useState(false);
  const [alert, setAlert] = useState(null);
  const [focus, setFocus] = useState(null); // {lat,lng, ts?:number}
  const mapRef = useRef();

  // Auto-show the list when returning to Collecting mode (helps students “find” the list again).
  useEffect(() => {
    if (mode === "collecting") setShowList(true);
  }, [mode, setShowList]);

  // If there are no locations, automatically switch to collecting (prevents stale 'done' in localStorage).
  useEffect(() => {
    if (locations.length === 0 && mode === "done") setMode("collecting");
  }, [locations.length, mode, setMode]);

  // Provide a reliable programmatic center: avoids “first center does nothing” when center ≈ same point.
  const centerOn = useCallback((lat, lng, zoom = 16) => {
    const map = mapRef.current;
    if (map) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), zoom), { animate: true, duration: 0.6 });
    } else {
      // fallback: trigger CenterMap render
      setFocus({ lat, lng, ts: Date.now() });
    }
  }, []);

  const onMapClick = useCallback((e) => {
    if (mode !== "collecting") {
      // clicks are ignored in Done mode by design; provide a helpful breadcrumb in DevTools
      console.warn("Ignored click because mode is 'done'. Use 'Start Collecting' to resume.");
      return;
    }
    const { lat, lng } = e.latlng;
    // opens modal by setting a pending click
    setPendingClick({ lat, lng });
  }, [mode]);

  const onAdd = useCallback(async (payload) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    /** @type {Location} */
    let loc = { id, createdAt: Date.now(), ...payload };
    if (!payload.extra?.displayName) {
      try {
        setGeocodeBusy(true);
        const extra = await reverseGeocode(payload.lat, payload.lng);
        loc = { ...loc, extra };
      } catch {
        // ignore: free API rate limits/offline
      } finally {
        setGeocodeBusy(false);
      }
    }
    setLocations((xs) => [...xs, loc]);
    setPendingClick(null);
    setAlert({ kind: "success", msg: "Location added." });
  }, [setLocations]);

  const onEdit = useCallback(async (id, payload) => {
    let next = { ...payload };
    if (!payload.extra?.displayName) {
      try {
        setGeocodeBusy(true);
        const extra = await reverseGeocode(payload.lat, payload.lng);
        next.extra = extra;
      } catch {
        // ignore
      } finally {
        setGeocodeBusy(false);
      }
    }
    setLocations((xs) => xs.map((x) => x.id === id ? { ...x, ...next } : x));
    setEditing(null);
    setAlert({ kind: "success", msg: "Location updated." });
  }, [setLocations]);

  const onDelete = useCallback((id) => {
    setLocations((xs) => xs.filter((x) => x.id !== id));
  }, [setLocations]);

  const onReset = useCallback(() => {
    setLocations([]);
    setMode("collecting");
    setShowList(true);
    setPendingClick(null);
    setEditing(null);
  }, [setLocations, setMode, setShowList]);

  const hasData = locations.length > 0;
  const bounds = useMemo(() => {
    if (!locations.length) return null;
    return L.latLngBounds(locations.map((l) => [l.lat, l.lng]));
  }, [locations]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          SNHU Map • Places You've Been{" "}
          {mode === "done" && <span className="badge">Done mode</span>}
        </div>
        <div className="controls">
          <button onClick={() => setShowList((v) => !v)}>{showList ? "Hide List" : "Show List"}</button>

          {/* Make Done a toggle: show Start Collecting when in done mode */}
          {mode === "done" ? (
            <button onClick={() => setMode("collecting")}>Start Collecting</button>
          ) : (
            <button onClick={() => setMode("done")} disabled={!hasData}>Done</button>
          )}

          <button onClick={onReset} disabled={!hasData}>Reset</button>
          <button onClick={() => downloadJson("locations.json", locations)} disabled={!hasData}>Save JSON</button>

          {/* Load JSON: restore a saved set, or import snhu.sample.json for a demo */}
          <label className="button" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            Load JSON
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={async (e) => {
                try {
                  const file = e.currentTarget.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  const parsed = JSON.parse(text);
                  const [ok, dataOrErr] = validateLocationsJson(parsed);
                  if (!ok) throw new Error(String(dataOrErr));
                  setLocations(dataOrErr);
                  setAlert({ kind: "success", msg: "Locations loaded." });
                } catch (err) {
                  setAlert({ kind: "error", msg: err instanceof Error ? err.message : "Failed to load file." });
                } finally {
                  e.currentTarget.value = "";       // allow re-uploading the same file
                }
              }}
            />
          </label>
        </div>
      </header>

      {showList && (
        <aside className="panel">
          <h2>{mode === "collecting" ? "Enter locations by clicking the map" : "Locations"}</h2>
          {alert && <div className={alert.kind === "error" ? "alert" : "alert success"}>{alert.msg}</div>}
          <div className="list">
            {locations.map((l) => (
              <div key={l.id} className="item">
                <div className="row">
                  <strong>{l.title || l.extra?.city || "Untitled"}</strong>
                  {l.years && <span className="badge">{l.years}</span>}
                </div>
                <div className="badge">{l.extra?.displayName || `${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}`}</div>
                {l.notes && <div>{l.notes}</div>}
                <div className="item-actions">
                  {/* Center now uses reliable flyTo() to ensure first center is noticeable */}
                  <button onClick={() => centerOn(l.lat, l.lng)}>Center</button>
                  <button onClick={() => { setEditing(l); setFocus({ lat: l.lat, lng: l.lng, ts: Date.now() }); }}>Edit</button>
                  <button onClick={() => onDelete(l.id)}>Delete</button>
                </div>
              </div>
            ))}
            {!locations.length && <div>No locations yet. Click on the map to add.</div>}
          </div>
        </aside>
      )}

      <div className="map-wrap">
        <MapContainer
          center={[43.03786, -71.44975]} // SNHU campus
          zoom={16}
          minZoom={2}
          maxZoom={19}
          style={{ height: "100%", width: "100%" }}
          whenCreated={(m) => (mapRef.current = m)}
          onClick={onMapClick}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Keep CenterMap as a passive recenter helper in case mapRef isn't ready */}
          {focus && <CenterMap lat={focus.lat} lng={focus.lng} />}

          {bounds && mode === "done" && <FitToBounds bounds={bounds} />}

          {locations.map((l) => (
            <Marker key={l.id} position={[l.lat, l.lng]}>
              <Popup>
                <div style={{ display: "grid", gap: 4, maxWidth: 260 }}>
                  <strong>{l.title || l.extra?.city || "Untitled"}</strong>
                  {l.years && <div><em>{l.years}</em></div>}
                  {l.extra?.displayName && <div style={{ fontSize: 12, color: "#555" }}>{l.extra.displayName}</div>}
                  {l.notes && <div>{l.notes}</div>}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setEditing(l)}>Edit</button>
                    <button onClick={() => onDelete(l.id)}>Delete</button>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Optional summary overlay at center when Done + data exists */}
          {mode === "done" && locations.length > 0 && <AllInfoOverlay locations={locations} />}
        </MapContainer>
      </div>

      {(pendingClick || editing) && (
        <LocationModal
          title={editing ? "Edit Location" : "Add Location"}
          initial={
            editing || { title: "", years: "", notes: "", lat: pendingClick.lat, lng: pendingClick.lng, extra: {} }
          }
          busy={geocodeBusy}
          onCancel={() => { setPendingClick(null); setEditing(null); }}
          onSubmit={(data) => { editing ? onEdit(editing.id, data) : onAdd(data); }}
        />
      )}
    </div>
  );
}

function FitToBounds({ bounds }) {
  // Fit the map to the given Leaflet LatLngBounds with padding.
  const map = useMap();
  useEffect(() => { map.fitBounds(bounds, { padding: [40, 40], animate: true }); }, [bounds, map]);
  return null;
}

function AllInfoOverlay({ locations }) {
  // Overlay that shows a compact, scrollable summary of all locations at map center.
  const map = useMap();
  const center = map.getCenter();
  // Instead of rendering all popups open, show a summary overlay at the map center
  return (
    <Circle center={[center.lat, center.lng]} radius={0}>
      <Popup position={[center.lat, center.lng]} open>
        <div style={{ maxHeight: 300, overflowY: "auto", maxWidth: 260 }}>
          <h4>All Locations</h4>
          <ul style={{ paddingLeft: 18 }}>
            {locations.map((l) => (
              <li key={l.id}>
                <strong>{l.title || l.extra?.city || "Untitled"}</strong>
                {l.years && <span> ({l.years})</span>}
                {l.extra?.displayName && (
                  <div style={{ fontSize: 12, color: "#555" }}>{l.extra.displayName}</div>
                )}
                {l.notes && <div>{l.notes}</div>}
              </li>
            ))}
          </ul>
        </div>
      </Popup>
    </Circle>
  );
}

function LocationModal({ title, initial, onCancel, onSubmit, busy }) {
  // Modal form for creating/editing a location. Keeps staged form state internally
  // until the user clicks Save which calls onSubmit(form).
  const [form, setForm] = useState(initial);
  useEffect(() => { setForm(initial); }, [initial]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="row">
          <div className="badge">Lat: {form.lat.toFixed(5)}</div>
          <div className="badge">Lng: {form.lng.toFixed(5)}</div>
          {form.extra?.city && <div className="badge">City: {form.extra.city}</div>}
        </div>

        <label>
          Title
          <input
            className="input"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g., Lived here"
          />
        </label>

        <label>
          Years
          <input
            className="input"
            value={form.years}
            onChange={(e) => setForm((f) => ({ ...f, years: e.target.value }))}
            placeholder="e.g., 2018–2022"
          />
        </label>

        <label>
          Notes
          <textarea
            rows={4}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Memories, restaurants, friends…"
          />
        </label>

        <div className="footer">
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={() => onSubmit(form)} disabled={busy} title={busy ? "Reverse-geocoding…" : undefined}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
// End of src/App.jsx
