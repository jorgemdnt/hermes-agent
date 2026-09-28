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
    transform: translateY(-3vh);
  }}

  .brand {{
    text-align: center;
    margin-bottom: 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--foreground);
  }}
  /* The Hermes portrait, painted in the text colour so it follows light/dark. */
  .brand-mark {{ display: block; width: 56px; height: 56px; background: currentColor;
    -webkit-mask: url("data:image/png;base64,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") center / contain no-repeat;
    mask: url("data:image/png;base64,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") center / contain no-repeat; }}
  .card {{ text-align: center; }}
  h1 {{
    margin: 0 0 1.25rem;
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
    background: var(--foreground);
    color: var(--background);
    font-family: inherit;
    font-weight: 500;
    font-size: 0.9rem;
    text-decoration: none;
    border: 1px solid var(--foreground);
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.12s ease-out, border-color 0.12s ease-out;
  }}
  .provider-btn svg {{ width: 18px; height: 18px; flex: none; }}
  .provider-btn:hover {{ background: color-mix(in srgb, var(--foreground) 85%, var(--background)); }}
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
    margin-top: 2.5rem;
    text-align: center;
    color: color-mix(in srgb, var(--foreground) 72%, transparent);
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
  <div class="brand"><span class="brand-mark" role="img" aria-label="Hermes"></span>Hermes</div>
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
