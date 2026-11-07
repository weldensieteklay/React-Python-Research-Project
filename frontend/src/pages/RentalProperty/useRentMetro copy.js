import { useCallback, useEffect, useRef, useState } from "react";
import { useFetchData } from "../../hooks/useFetchData";

// Which metro the rental dashboard shows.
//
// DFW is shown right away, so nobody waits on the permission prompt. On the first visit the
// browser asks for the viewer's location; if they allow it, their nearest Zillow metro
// (data/rent-locate) replaces DFW. If they decline, ignore the prompt, are far from any metro,
// or the lookup fails, DFW stays. A metro found from their location, or picked from the list,
// is remembered in this browser, so later visits don't ask again.
//
// metro:    Zillow metro name (never null)
// match:    { zip_code, city, distance_mi, metro_zip_count } when the metro came from their location
// note:     why the location lookup didn't change anything (permission denied, ...), else null
// locating: true while waiting for the browser or the lookup

export const DFW_METRO = "Dallas-Fort Worth-Arlington, TX";
const STORAGE_KEY = "rentDashboard.metro";

/** The metro saved in this browser, or null. Also used by pages that don't ask for location. */
export function readSavedMetro() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function save(metro) {
  try { localStorage.setItem(STORAGE_KEY, metro); } catch { /* private mode etc. */ }
}

const GEO_ERRORS = {
  1: "Location access wasn't allowed",
  2: "Your location isn't available right now",
  3: "Finding your location took too long",
};

// ~1 km precision is plenty to find a metro, and sends less about the viewer than a GPS fix
const coarse = (v) => Math.round(v * 100) / 100;

export function useRentMetro() {
  const [metro, setMetro] = useState(() => readSavedMetro() || DFW_METRO);
  const [match, setMatch] = useState(null);
  const [note, setNote] = useState(null);
  const [locating, setLocating] = useState(false);
  const locate = useFetchData();
  // Set while a lookup we started is in flight, so an old response never moves the dashboard
  const waitingRef = useRef(false);
  // Bumped by every ask and every pick: a browser answer for an older ask is ignored, so
  // picking a metro while the permission prompt is still open can't be undone by "Allow"
  const askIdRef = useRef(0);

  const keepCurrent = useCallback((reason) => {
    waitingRef.current = false;
    setLocating(false);
    setNote(reason);
  }, []);

  const askForLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return keepCurrent("Your browser can't share its location. Pick your metro from the list instead.");
    }
    const askId = ++askIdRef.current;
    setLocating(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (askId !== askIdRef.current) return;
        waitingRef.current = true;
        locate.handleFetch("data/rent-locate", { lat: coarse(coords.latitude), lon: coarse(coords.longitude) });
      },
      (err) => {
        if (askId !== askIdRef.current) return;
        keepCurrent(`${GEO_ERRORS[err.code] || "We couldn't get your location"}, so you're seeing the metro below. Pick yours from the list to change it.`);
      },
      // Metro-level accuracy is enough, so a coarse, recent fix is fine
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60 * 60 * 1000 },
    );
  }, [locate.handleFetch, keepCurrent]);

  // First visit (nothing saved): ask once. The dashboard already shows DFW meanwhile.
  useEffect(() => {
    if (!readSavedMetro()) askForLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!waitingRef.current) return;
    if (locate.data) {
      waitingRef.current = false;
      setLocating(false);
      if (locate.data.metro) {
        setMatch(locate.data);
        setMetro(locate.data.metro);
        save(locate.data.metro);
      } else {
        setMatch(null);
        setNote(`${locate.data.reason || "There's no Zillow rent data near you"}, so you're seeing the metro below. Pick another from the list if you like.`);
      }
    } else if (locate.error) {
      keepCurrent("We couldn't match your location to a metro. Pick yours from the list instead.");
    }
  }, [locate.data, locate.error, keepCurrent]);

  const chooseMetro = useCallback((m) => {
    askIdRef.current += 1;        // an explicit pick wins over an ask or lookup still in flight
    waitingRef.current = false;
    setLocating(false);
    setMatch(null);
    setNote(null);
    setMetro(m);
    save(m);
  }, []);

  return { metro, match, note, locating, askForLocation, chooseMetro };
}
