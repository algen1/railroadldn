import { useEffect, useRef, useState } from "react";
import { fetchArrivals, loadRoutes } from "./tfl";
import { placeTrains } from "./placeTrain";
import type { LineRoute, Train } from "./types";

const POLL_MS = 20000;

export type NetworkStatus = "loading" | "live" | "error";

export function useNetwork() {
  const [routes, setRoutes] = useState<LineRoute[]>([]);
  const [trains, setTrains] = useState<Train[]>([]);
  const [status, setStatus] = useState<NetworkStatus>("loading");
  const [message, setMessage] = useState("Drawing the tracks");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const routesRef = useRef<LineRoute[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    let busy = false;

    const tick = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const network = routesRef.current.length > 0 ? routesRef.current : await loadRoutes();
        if (controller.signal.aborted) return;
        if (routesRef.current.length === 0) {
          routesRef.current = network;
          setRoutes(network);
        }
        setMessage("Listening for trains");
        const arrivals = await fetchArrivals(controller.signal);
        if (controller.signal.aborted) return;
        setTrains(placeTrains(network, arrivals));
        setUpdatedAt(new Date());
        setStatus("live");
        setMessage("");
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Could not reach TfL");
      } finally {
        busy = false;
      }
    };

    void tick();
    timer = window.setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [retryToken]);

  return {
    routes,
    trains,
    status,
    message,
    updatedAt,
    reload: () => setRetryToken((value) => value + 1),
  };
}
