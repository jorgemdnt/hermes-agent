import { lazy, Suspense } from "react";

const MobileApp = lazy(() => import("./MobileApp"));

export default function MobileRoot() {
  return <Suspense fallback={<div role="status">Loading Hermes…</div>}><MobileApp /></Suspense>;
}
