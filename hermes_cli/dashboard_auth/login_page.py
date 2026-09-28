"""Server-rendered /login page (no React, no SPA bundle, no injected token).

Providers come from the registry; an OAuth provider renders an anchor to
``/auth/login?provider=<name>``, a ``supports_password`` provider renders a
credential form wired by :data:`_PASSWORD_FORM_SCRIPT`. Styling mirrors the
``@nous-research/ui`` design system; fonts load from the SPA's ``/fonts/``
mount, which the gate allowlists pre-auth.

The ``class="provider-btn"`` anchor is test-stable: the suite extracts its
href to walk the OAuth flow.
"""
from __future__ import annotations

import html
from urllib.parse import quote, urlencode

from hermes_cli.dashboard_auth import list_session_providers

# Single curly braces are ``str.format`` placeholders; CSS curlies are doubled.
_LOGIN_HTML_TEMPLATE = """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Hermes Bots</title>
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
<style>
  :root {{
    color-scheme: light dark;
    --background-base: #ffffff;
    --background: #ffffff;
    --midground: #171717;
    --foreground: #171717;
    --hairline: #e5e5e5;
    --hairline-strong: #a3a3a3;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --background-base: #0a0a0a;
      --background: #0a0a0a;
      --midground: #fafafa;
      --foreground: #fafafa;
      --hairline: #262626;
      --hairline-strong: #737373;
    }}
  }}

  *, *::before, *::after {{ box-sizing: border-box; }}

  html, body {{
    margin: 0;
    padding: 0;
    min-height: 100%;
    background: var(--background-base);
    color: var(--foreground);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }}

  body {{ display: grid; place-items: center; min-height: 100dvh; padding: 6rem 1.5rem; }}
  body.native {{ padding-top: 8rem; }}
  .native .window-drag {{ position: fixed; inset: 0 0 auto; height: 52px; -webkit-app-region: drag; }}
  main {{
    width: 100%;
    max-width: 23rem;
    position: relative;
  }}

  .brand {{
    text-align: center;
    margin-bottom: 3.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--foreground);
  }}
  .brand-mark {{ display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid var(--hairline); border-radius: 14px; }}
  .brand svg {{ width: 23px; height: 23px; stroke: currentColor; stroke-width: 1.8; fill: none; stroke-linecap: round; stroke-linejoin: round; }}
  .card {{ text-align: center; }}
  h1 {{
    margin: 0 0 2rem;
    font-family: inherit;
    font-weight: 600;
    font-size: 1.65rem;
    letter-spacing: -.03em;
    text-wrap: balance;
    color: var(--foreground);
  }}


  .provider-list {{
    display: grid;
    gap: 0.75rem;
  }}

  .provider-btn {{
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    min-height: 48px;
    padding: 0.75rem 1rem;
    background: var(--background-base);
    color: var(--foreground);
    font-family: inherit;
    font-weight: 500;
    font-size: 0.9rem;
    text-decoration: none;
    border: 1px solid var(--hairline);
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.12s ease-out, border-color 0.12s ease-out;
  }}
  .provider-btn svg {{ width: 18px; height: 18px; flex: none; }}
  .provider-btn:hover {{ background: color-mix(in srgb, var(--foreground) 5%, var(--background-base)); border-color: var(--hairline-strong); }}
  .provider-btn:focus-visible {{ outline: 2px solid var(--midground); outline-offset: 3px; }}

  /* Password provider form shares the same card and button tokens. */
  .provider-form {{
    display: grid;
    gap: 0.75rem;
    text-align: left;
  }}
  .form-title {{
    font-family: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--foreground) 70%, transparent);
  }}
  .field {{
    display: grid;
    gap: 0.3rem;
  }}
  .field-label {{
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--foreground) 55%, transparent);
  }}
  .field-input {{
    width: 100%;
    box-sizing: border-box;
    padding: 0.7rem 0.8rem;
    background: color-mix(in srgb, var(--foreground) 4%, var(--background-base));
    color: var(--foreground);
    border: 1px solid var(--hairline-strong);
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.95rem;
  }}
  .field-input:focus-visible {{
    outline: none;
    border-color: var(--midground);
    box-shadow: 0 0 0 1px var(--midground);
  }}
  .form-error {{
    color: #ff6b6b;
    font-size: 0.82rem;
    letter-spacing: 0.02em;
  }}
  .provider-form .provider-btn {{
    margin-top: 0.25rem;
  }}

  footer {{
    margin-top: 3.5rem;
    text-align: center;
    color: color-mix(in srgb, var(--foreground) 52%, transparent);
    font-size: 0.78rem;
    line-height: 1.5;
  }}
  #native-status {{ min-height: 1.5em; margin: 1rem 0 0; color: var(--foreground); font-size: 0.85rem; }}

  /* Selection — DS uses midground bg + background text. */
  ::selection {{
    background: var(--midground);
    color: var(--background-base);
  }}
</style>
</head>
<body>
<div class="window-drag" aria-hidden="true"></div>
<main>
  <div class="brand"><span class="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4H8M9 14h.01M15 14h.01M9 17h6"/></svg></span>Hermes Bots</div>
  <div class="card">
    <h1>Sign in to Hermes</h1>
    <div class="provider-list">
{provider_buttons}
    </div>
    <p id="native-status" role="status" aria-live="polite"></p>
  </div>
  <footer>Private access to your bots</footer>
</main>
{password_script}
<script>
  if (window.hermetic) document.body.classList.add('native');
  document.addEventListener('click', function (event) {{
    var link = event.target.closest('a[data-native-provider]');
    if (!link || !window.hermetic || typeof window.hermetic.signIn !== 'function') return;
    event.preventDefault();
    link.setAttribute('aria-busy', 'true');
    var status = document.getElementById('native-status');
    status.textContent = 'Continue signing in in your browser…';
    window.hermetic.signIn(link.dataset.nativeProvider).catch(function () {{
      link.removeAttribute('aria-busy');
      status.textContent = 'Could not open sign-in. Please try again.';
    }});
  }});
</script>
</body>
</html>
"""

_EMPTY_HTML = """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in unavailable — Hermes Agent</title>
<style>
  @font-face {
    font-family: 'Collapse';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('/fonts/Collapse-Regular.woff2') format('woff2');
  }
  @font-face {
    font-family: 'Rules Compressed';
    font-style: normal;
    font-weight: 600;
    font-display: swap;
    src: url('/fonts/RulesCompressed-Medium.woff2') format('woff2');
  }
  :root {
    color-scheme: light dark;
    --background-base: #fff;
    --midground: #171717;
    --foreground: #171717;
    --hairline: #e5e5e5;
  }
  @media (prefers-color-scheme: dark) {
    :root { --background-base: #0a0a0a; --midground: #fafafa; --foreground: #fafafa; --hairline: #262626; }
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; min-height: 100%;
    background: var(--background-base);
    color: var(--foreground);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 16px; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  body {
    display: grid; place-items: center;
    padding: clamp(1.5rem, 6vh, 6rem) 1.25rem;
  }
  main {
    width: 100%; max-width: 32rem;
    padding: 2.25rem 2rem;
    background: color-mix(in srgb, #ffffff 2%, var(--background-base));
    border: 1px solid var(--hairline);
    box-shadow:
      inset 1px 1px 0 0 color-mix(in srgb, #ffffff 5%, transparent),
      inset -1px -1px 0 0 rgba(0, 0, 0, 0.4),
      0 24px 60px -20px rgba(0, 0, 0, 0.6);
  }
  h1 {
    margin: 0 0 1rem;
    font-family: 'Rules Compressed', 'Collapse', sans-serif;
    font-weight: 600; font-size: 1.5rem;
    letter-spacing: 0.05em; text-transform: uppercase;
    color: var(--midground);
  }
  p { margin: 0 0 1rem; }
  code {
    background: var(--midground);
    color: var(--background-base);
    padding: 0.1em 0.35em;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
  }
  a { color: var(--midground); }
</style>
</head>
<body>
<main>
<h1>Sign-in unavailable</h1>
<p>This dashboard is bound to a non-loopback host but no authentication
providers are available.</p>
<p>Configure the bundled username/password provider or an OAuth provider.
See the <a href="https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard#authentication-gated-mode">dashboard
authentication documentation</a> for setup instructions.</p>
<p>For auth-free local use, bind to <code>127.0.0.1</code> and connect through
an SSH tunnel or Tailscale.</p>
</main>
</body>
</html>
"""


# Emitted ONLY when a ``supports_password`` provider is listed, so OAuth-only
# login pages stay script-free. Plain string (not ``str.format``): braces are
# literal. One delegated submit handler covers every form; the provider name
# comes from the form's ``data-provider`` attribute.
_PASSWORD_FORM_SCRIPT = """\
<script>
(function () {
  function handle(form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = form.querySelector('.form-error');
      var btn = form.querySelector('button[type=submit]');
      if (err) { err.hidden = true; err.textContent = ''; }
      if (btn) { btn.disabled = true; }
      var body = {
        provider: form.getAttribute('data-provider') || '',
        username: (form.querySelector('input[name=username]') || {}).value || '',
        password: (form.querySelector('input[name=password]') || {}).value || '',
        next: (form.querySelector('input[name=next]') || {}).value || ''
      };
      fetch('/auth/password-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin'
      }).then(function (resp) {
        if (resp.ok) {
          return resp.json().then(function (data) {
            window.location.assign((data && data.next) || '/');
          });
        }
        var msg = resp.status === 429
          ? 'Too many attempts. Please wait and try again.'
          : (resp.status === 401 ? 'Invalid username or password.'
                                 : 'Sign-in failed. Please try again.');
        if (err) { err.textContent = msg; err.hidden = false; }
        if (btn) { btn.disabled = false; }
      }).catch(function () {
        if (err) { err.textContent = 'Network error. Please try again.'; err.hidden = false; }
        if (btn) { btn.disabled = false; }
      });
    });
  }
  var forms = document.querySelectorAll('form.provider-form');
  for (var i = 0; i < forms.length; i++) { handle(forms[i]); }
})();
</script>
"""


_GOOGLE_LOGO = '''<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.2 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.9 24.6c0-1.6-.2-3.1-.5-4.6H24v9.1h12.8c-.6 3-2.2 5.5-4.7 7.2l7.7 6c4.5-4.1 7.1-10.2 7.1-17.7z"/><path fill="#FBBC05" d="M10.6 28.6A14.4 14.4 0 0 1 9.8 24c0-1.6.3-3.1.8-4.6l-8-6.2A23.8 23.8 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l8-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 12-2.1 16-5.7l-7.7-6C30.1 37.8 27.3 38.5 24 38.5c-6.2 0-11.5-4.1-13.4-9.9l-8 6.2C6.5 42.6 14.6 48 24 48z"/></svg>'''


def _provider_label(provider) -> str:
    return "Continue with Google" if getattr(provider, "_issuer", "") == "https://accounts.google.com" else f"Continue with {provider.display_name}"


def _provider_logo(provider) -> str:
    return _GOOGLE_LOGO if getattr(provider, "_issuer", "") == "https://accounts.google.com" else ""


def render_login_html(*, next_path: str = "") -> str:
    """Return the full HTML for ``GET /login``.

    ``next_path`` is threaded into each provider button/form so the OAuth round
    trip carries it end-to-end. The caller validates it same-origin; it is
    HTML-escaped here as defence in depth.
    """
    providers = list_session_providers()
    if not providers:
        return _EMPTY_HTML
    # URL-encode then HTML-escape, matching the gate's ``_safe_next_target``
    # shape so a round-tripped value is byte-identical.
    next_qs = f"&next={html.escape(quote(next_path, safe=''), quote=True)}" if next_path else ""
    buttons = [
        _render_password_form(p, next_path) if getattr(p, "supports_password", False) else
        f'      <a class="provider-btn" '
        f'href="/auth/login?provider={html.escape(p.name, quote=True)}{next_qs}" '
        f'data-native-provider="{html.escape(p.name, quote=True)}">'
        f'{_provider_logo(p)}{html.escape(_provider_label(p))}</a>'
        for p in providers
    ]
    needs_password_script = any(getattr(p, "supports_password", False) for p in providers)
    return _LOGIN_HTML_TEMPLATE.format(
        provider_buttons="\n".join(buttons),
        password_script=_PASSWORD_FORM_SCRIPT if needs_password_script else "",
    )


def render_native_provider_choice_html(
        *, providers, authorize_path: str, code_challenge: str,
        code_challenge_method: str, redirect_uri: str, state: str) -> str:
    """Provider picker for a native authorize request with more than one interactive provider.

    Every link re-enters ``/auth/native/authorize`` with the SAME desktop PKCE inputs plus an
    explicit ``provider``, so the choice never leaves the validated native flow.
    """
    common = {"code_challenge": code_challenge, "code_challenge_method": code_challenge_method,
              "redirect_uri": redirect_uri, "state": state}
    buttons = []
    for p in providers:
        href = html.escape(f"{authorize_path}?{urlencode({**common, 'provider': p.name})}",
                           quote=True)
        buttons.append(f'      <a class="provider-btn" href="{href}">'
                       f'{_provider_logo(p)}{html.escape(_provider_label(p))}</a>')
    if not buttons:
        return _EMPTY_HTML
    return _LOGIN_HTML_TEMPLATE.format(provider_buttons="\n".join(buttons), password_script="")


def _render_password_form(provider, next_path: str) -> str:
    """Username/password form for a ``supports_password`` provider.

    ``next_path`` rides in a hidden field (already validated by the caller,
    HTML-escaped here). The provider name is a ``data-`` attribute so the
    script does not depend on field ordering.
    """
    pname = html.escape(provider.name, quote=True)
    plabel = html.escape(provider.display_name)
    safe_next = html.escape(next_path, quote=True) if next_path else ""
    return (
        f'      <form class="provider-form" data-provider="{pname}" '
        f'autocomplete="on">\n'
        f'        <div class="form-title">Sign in with {plabel}</div>\n'
        f'        <input type="hidden" name="next" value="{safe_next}">\n'
        f'        <label class="field">\n'
        f'          <span class="field-label">Username</span>\n'
        f'          <input class="field-input" type="text" name="username" '
        f'autocomplete="username" autocapitalize="none" '
        f'autocorrect="off" spellcheck="false" required>\n'
        f'        </label>\n'
        f'        <label class="field">\n'
        f'          <span class="field-label">Password</span>\n'
        f'          <input class="field-input" type="password" name="password" '
        f'autocomplete="current-password" required>\n'
        f'        </label>\n'
        f'        <div class="form-error" role="alert" hidden></div>\n'
        f'        <button class="provider-btn" type="submit">Sign in</button>\n'
        f'      </form>'
    )
