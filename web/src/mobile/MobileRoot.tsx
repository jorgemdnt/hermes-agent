import { lazy, Suspense } from "react";
import { mobileRoute } from "./mobile-routes";
import "./mobile-theme.css";
import "./mobile.css";

const MobileApp = lazy(() => import("./MobileApp"));

export default function MobileRoot() {
  const theme = window.localStorage.getItem("hermes-mobile-theme");
  const view = mobileRoute(window.location.pathname).view;
  return <Suspense fallback={<div className="m-shell" data-theme={theme === "light" || theme === "dark" ? theme : "system"} role="status" aria-label={`Loading ${view === "bots" ? "bots" : "conversation"}`}>
    {view === "bots" ? <><header className="m-list-header"><span className="m-icon-button m-profile-button" /><span className="m-icon-button" /><span className="m-icon-button" /></header><main className="m-bot-list"><div className="m-loading"><span className="m-skeleton" /><span className="m-skeleton" /><span className="m-skeleton" /></div></main></> : <>
      <header className="m-header"><span className="m-icon-button" /><span className="m-avatar-button"><span className="m-skeleton m-avatar-skeleton" /></span><div className="m-identity"><span className="m-skeleton m-name-skeleton" /></div></header>
      <main className="m-main"><div className="m-messages"><div className="m-loading"><span className="m-skeleton" /><span className="m-skeleton" /><span className="m-skeleton" /></div></div></main>
    </>}
  </div>}><MobileApp /></Suspense>;
}
